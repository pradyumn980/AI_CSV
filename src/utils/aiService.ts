import { GoogleGenerativeAI } from '@google/generative-ai';

export interface CRMLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  revenue: string; // Estimated deal size / budget
  source: string;
  status: 'New' | 'Contacted' | 'Qualified' | 'Lost';
  location: string;
  validationErrors: {
    name?: string;
    email?: string;
    phone?: string;
    revenue?: string;
  };
  isCleanedByAI?: boolean;
  leadScore?: number;
  leadGrade?: 'A' | 'B' | 'C' | 'D';
  segment?: 'Enterprise' | 'Mid-Market' | 'SMB' | 'Unknown';
  nextAction?: string;
}

export interface ColumnMapping {
  csvHeader: string | null; // null means not mapped
  confidence: 'high' | 'medium' | 'low' | 'none';
  reason: string;
}

export type MappingResult = Record<string, ColumnMapping>;

// Standard lead fields in CRM
export const TARGET_FIELDS = [
  { key: 'name', label: 'Lead Name', required: true, description: 'Full name of the lead' },
  { key: 'email', label: 'Email Address', required: true, description: 'Primary contact email' },
  { key: 'phone', label: 'Phone Number', required: false, description: 'Contact telephone' },
  { key: 'company', label: 'Company Name', required: false, description: 'Organization they work for' },
  { key: 'jobTitle', label: 'Job Title', required: false, description: 'Role or designation' },
  { key: 'revenue', label: 'Deal Value ($)', required: false, description: 'Estimated contract value' },
  { key: 'source', label: 'Lead Source', required: false, description: 'LinkedIn, Web, Cold outreach, Referral' },
  { key: 'location', label: 'Location', required: false, description: 'City, state, or country' },
  { key: 'status', label: 'Lead Status', required: false, description: 'New, Contacted, Qualified, Lost' }
];

// Synonyms dictionary for local heuristic mapping
const FIELD_SYNONYMS: Record<string, string[]> = {
  name: ['name', 'full name', 'fullname', 'lead name', 'contact name', 'person', 'client name', 'customer', 'first name', 'last name', 'fname', 'lname'],
  email: ['email', 'e-mail', 'email address', 'mail', 'mail address', 'contact email', 'client email', 'primary email'],
  phone: ['phone', 'phone number', 'phone_number', 'telephone', 'ph', 'mobile', 'cell', 'contact number', 'tel'],
  company: ['company', 'organization', 'org', 'business', 'firm', 'employer', 'company name', 'corporation'],
  jobTitle: ['job title', 'title', 'role', 'position', 'designation', 'job_title', 'occupation'],
  revenue: ['revenue', 'value', 'estimated value', 'deal size', 'amount', 'budget', 'worth', 'sales', 'deal value', 'deal_value', 'money'],
  source: ['source', 'lead source', 'channel', 'medium', 'origin', 'how found', 'lead_source'],
  status: ['status', 'stage', 'lead status', 'progress', 'state', 'lead_status'],
  location: ['location', 'city', 'country', 'address', 'state', 'region', 'geo', 'town']
};

/**
 * Validate a single lead record
 */
export const validateLead = (lead: Partial<CRMLead>): CRMLead['validationErrors'] => {
  const errors: CRMLead['validationErrors'] = {};
  
  if (!lead.name || !lead.name.trim()) {
    errors.name = 'Lead Name is required';
  }
  
  if (!lead.email || !lead.email.trim()) {
    errors.email = 'Email Address is required';
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lead.email.trim())) {
      errors.email = 'Invalid email address format';
    }
  }
  
  if (lead.phone && lead.phone.trim()) {
    const phoneDigitsOnly = lead.phone.replace(/[^0-9]/g, '');
    if (phoneDigitsOnly.length < 7 && phoneDigitsOnly.length > 0) {
      errors.phone = 'Phone number is too short';
    }
  }

  if (lead.revenue && lead.revenue.trim()) {
    const cleanRevenue = lead.revenue.replace(/[^0-9.]/g, '');
    if (isNaN(Number(cleanRevenue))) {
      errors.revenue = 'Deal value must be a valid number';
    }
  }
  
  return errors;
};

/**
 * Capitalizes names and standardizes common inputs locally
 */
export const cleanLeadDataLocally = (lead: Partial<CRMLead>): Partial<CRMLead> => {
  const cleaned = { ...lead };
  
  // Format Name: "john doe" -> "John Doe"
  if (cleaned.name) {
    cleaned.name = cleaned.name
      .trim()
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // Format Email
  if (cleaned.email) {
    cleaned.email = cleaned.email.trim().toLowerCase();
  }

  // Format Phone: remove brackets, space, clean up
  if (cleaned.phone) {
    cleaned.phone = cleaned.phone.trim();
  }

  // Format Revenue: clean currency symbol
  if (cleaned.revenue) {
    const numbersOnly = cleaned.revenue.replace(/[^0-9.]/g, '');
    if (numbersOnly && !isNaN(Number(numbersOnly))) {
      cleaned.revenue = Number(numbersOnly).toString();
    }
  }

  // Standardize Status
  if (cleaned.status) {
    const rawStatus = cleaned.status.toLowerCase().trim();
    if (rawStatus.includes('new') || rawStatus.includes('lead') || rawStatus === '') {
      cleaned.status = 'New';
    } else if (rawStatus.includes('contact') || rawStatus.includes('progress') || rawStatus.includes('call')) {
      cleaned.status = 'Contacted';
    } else if (rawStatus.includes('qualif') || rawStatus.includes('warm') || rawStatus.includes('won') || rawStatus.includes('deal')) {
      cleaned.status = 'Qualified';
    } else if (rawStatus.includes('lost') || rawStatus.includes('cold') || rawStatus.includes('dead') || rawStatus.includes('junk')) {
      cleaned.status = 'Lost';
    } else {
      cleaned.status = 'New';
    }
  } else {
    cleaned.status = 'New';
  }

  return cleaned;
};

/**
 * Local Smart Heuristic Mapping Engine (regex & synonymous checks)
 */
export const performLocalMapping = (headers: string[], sampleRows: Record<string, string>[]): MappingResult => {
  const result: MappingResult = {};
  
  // Set up default mapping structures
  TARGET_FIELDS.forEach(field => {
    result[field.key] = { csvHeader: null, confidence: 'none', reason: 'No mapping found' };
  });

  const lowercaseHeaders = headers.map(h => h.toLowerCase().trim());
  const mappedCsvHeaders = new Set<string>();

  // 1. Direct Name Match / Synonym Match
  TARGET_FIELDS.forEach(field => {
    const synonyms = FIELD_SYNONYMS[field.key] || [];
    
    // Check for exact matching or synonym matching
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const normHeader = lowercaseHeaders[i];
      
      if (mappedCsvHeaders.has(header)) continue;

      if (normHeader === field.key.toLowerCase() || synonyms.includes(normHeader)) {
        result[field.key] = {
          csvHeader: header,
          confidence: 'high',
          reason: `Matched via synonyms dictionary: "${header}" -> ${field.label}`
        };
        mappedCsvHeaders.add(header);
        break;
      }
    }
  });

  // 2. Format Sniffing Fallback (Look at first few rows of CSV)
  TARGET_FIELDS.forEach(field => {
    // If field is already mapped, skip
    if (result[field.key].confidence === 'high') return;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (mappedCsvHeaders.has(header)) continue;

      // Sniff data format from sample rows (up to 5 rows)
      let matchesFormatCount = 0;
      let totalValidSamples = 0;
      
      sampleRows.slice(0, 5).forEach(row => {
        const val = (row[header] || '').trim();
        if (!val) return;
        totalValidSamples++;

        if (field.key === 'email') {
          if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(val)) matchesFormatCount++;
        } else if (field.key === 'phone') {
          // Standard phone pattern
          if (/^\+?[0-9\s\-()]{7,18}$/.test(val)) matchesFormatCount++;
        } else if (field.key === 'revenue') {
          // Contains currency or pure numbers
          if (/^\$?\d+(,\d{3})*(\.\d+)?$/.test(val) || (val.includes('$') && /\d+/.test(val))) matchesFormatCount++;
        }
      });

      if (totalValidSamples > 0 && matchesFormatCount / totalValidSamples >= 0.6) {
        result[field.key] = {
          csvHeader: header,
          confidence: 'medium',
          reason: `Sniffed sample data format: values in "${header}" match standard ${field.label} pattern`
        };
        mappedCsvHeaders.add(header);
        break;
      }
    }
  });

  // 3. Fuzzy Match Fallback (For leftover unmapped headers)
  TARGET_FIELDS.forEach(field => {
    if (result[field.key].csvHeader !== null) return;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (mappedCsvHeaders.has(header)) continue;

      const normHeader = lowercaseHeaders[i];
      
      // Let's do a simple sub-string search
      const isFuzzyMatch = normHeader.includes(field.key.toLowerCase()) || 
                           field.key.toLowerCase().includes(normHeader);
                           
      if (isFuzzyMatch && normHeader.length >= 3) {
        result[field.key] = {
          csvHeader: header,
          confidence: 'medium',
          reason: `Fuzzy matched string similarity: "${header}" contains keywords similar to ${field.label}`
        };
        mappedCsvHeaders.add(header);
        break;
      }
    }
  });

  return result;
};

/**
 * Local fallback for unstructured rows (uses regular expressions)
 */
export const parseUnstructuredRowsLocally = (rows: Record<string, string>[]): Partial<CRMLead>[] => {
  return rows.map(row => {
    // Get the first cell value (unstructured data)
    const text = Object.values(row)[0] || '';
    if (!text.trim()) return {};

    const lead: Partial<CRMLead> = {
      name: '',
      email: '',
      phone: '',
      company: '',
      jobTitle: '',
      revenue: '',
      source: 'Unstructured File',
      status: 'New',
      location: ''
    };

    // 1. Extract Email
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      lead.email = emailMatch[0];
    }

    // 2. Extract Phone
    const phoneMatch = text.match(/\+?\d{1,4}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/);
    if (phoneMatch && phoneMatch[0].replace(/[^0-9]/g, '').length >= 7) {
      lead.phone = phoneMatch[0];
    }

    // 3. Extract Revenue
    const revenueMatch = text.match(/\$\s?\d+(?:,\d{3})*(?:\.\d+)?/);
    if (revenueMatch) {
      lead.revenue = revenueMatch[0].replace(/[^0-9.]/g, '');
    }

    // 4. Try to parse Name / Title / Company by separating text
    // E.g. "Jane Smith, VP of Sales at Stripe"
    const cleanedText = text
      .replace(lead.email || '', '')
      .replace(lead.phone || '', '')
      .replace(revenueMatch ? revenueMatch[0] : '', '')
      .trim();

    const parts = cleanedText.split(/[,|\-()]/).map(p => p.trim()).filter(Boolean);
    
    if (parts.length > 0) {
      // First part is likely name
      lead.name = parts[0];
      
      if (parts.length > 1) {
        // Second part might contain title & company, e.g. "VP of Sales at Stripe"
        const secondPart = parts[1];
        if (secondPart.toLowerCase().includes(' at ')) {
          const atSplit = secondPart.split(/\s+at\s+/i);
          lead.jobTitle = atSplit[0].trim();
          lead.company = atSplit[1].replace(/[^a-zA-Z0-9\s]/g, '').trim();
        } else if (secondPart.toLowerCase().includes('@')) {
          // E.g. "VP of Sales @ Stripe"
          const atSplit = secondPart.split(/\s*@\s*/);
          lead.jobTitle = atSplit[0].trim();
          lead.company = atSplit[1].replace(/[^a-zA-Z0-9\s]/g, '').trim();
        } else {
          lead.jobTitle = secondPart;
        }
      }

      if (parts.length > 2 && !lead.company) {
        // Third part might be company
        lead.company = parts[2];
      }
    }

    return lead;
  });
};

/**
 * Call Gemini API to map columns
 */
export const performAIMapping = async (
  apiKey: string,
  headers: string[],
  sampleRows: Record<string, string>[]
): Promise<MappingResult> => {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash', // stable flash model for fast tasks
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `
      You are an expert CRM data integration system. Map the list of incoming CSV headers to the standard CRM target fields.
      
      Target Fields:
      ${JSON.stringify(TARGET_FIELDS, null, 2)}

      Incoming CSV Headers:
      ${JSON.stringify(headers, null, 2)}

      Sample rows from CSV:
      ${JSON.stringify(sampleRows.slice(0, 3), null, 2)}

      Instructions:
      1. For each target field key, determine if any incoming CSV header maps to it. 
      2. Set "csvHeader" to the exact matching header name. If no header maps to the field, set "csvHeader" to null.
      3. Set "confidence" to 'high', 'medium', or 'low'.
      4. Provide a clear, short "reason" for your choice (e.g. "Matches standard contact email formatting", "Header represents deal sizes").
      
      Return a JSON object in this exact schema:
      {
        "mappings": {
          "name": { "csvHeader": string | null, "confidence": "high" | "medium" | "low" | "none", "reason": string },
          "email": { "csvHeader": string | null, "confidence": "high" | "medium" | "low" | "none", "reason": string },
          ... // for every target field key
        }
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const jsonText = response.text();
    const data = JSON.parse(jsonText);
    
    if (data && data.mappings) {
      return data.mappings;
    }
    throw new Error('Invalid JSON format returned from Gemini');
  } catch (error) {
    console.warn('Gemini AI Mapping failed, falling back to local mapper:', error);
    return performLocalMapping(headers, sampleRows);
  }
};

/**
 * Call Gemini API to clean a list of raw records
 */
export const performAICleaning = async (
  apiKey: string,
  leads: Partial<CRMLead>[]
): Promise<Partial<CRMLead>[]> => {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `
      You are a data cleaning assistant for a CRM database. 
      Clean, standardize, and format the following array of lead records.
      
      Rules:
      1. Standardize Names: capitalize first and last names (e.g., "john doe" -> "John Doe").
      2. Standardize Emails: lowercase, remove whitespaces.
      3. Standardize Phone Numbers: clean and try to format to international style (e.g., "+1-555-0199"). If invalid or garbage, leave as is but clean space.
      4. Standardize Revenue: extract the numerical contract size/revenue as a simple number string (e.g. "$50k" -> "50000", "$1,200.50" -> "1200.50").
      5. Standardize Status: map to one of ['New', 'Contacted', 'Qualified', 'Lost'].
      6. Standardize Location: format cities and countries nicely (e.g. "sf, usa" -> "San Francisco, USA").
      7. Keep other fields like company, jobTitle, and source clean.
      
      Leads to clean:
      ${JSON.stringify(leads, null, 2)}

      Return a JSON object in this exact schema:
      {
        "cleanedLeads": [
          // array of cleaned lead objects matching the input length and structure
        ]
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const jsonText = response.text();
    const data = JSON.parse(jsonText);
    
    if (data && data.cleanedLeads) {
      return data.cleanedLeads.map((lead: any) => ({
        ...lead,
        isCleanedByAI: true
      }));
    }
    throw new Error('Invalid JSON format returned from Gemini');
  } catch (error) {
    console.warn('Gemini AI Cleaning failed, falling back to local cleaning:', error);
    return leads.map(lead => ({
      ...cleanLeadDataLocally(lead),
      isCleanedByAI: false
    }));
  }
};

/**
 * Call Gemini API to extract fields from unstructured text CSV
 */
export const performAIExtractionUnstructured = async (
  apiKey: string,
  rows: Record<string, string>[]
): Promise<Partial<CRMLead>[]> => {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `
      You are an expert entity extraction system. You will receive an array of records where each record contains a single text block of unstructured lead information (e.g., "John Doe - john@gmail.com - CEO at Stripe, $500k deal, located in SF").
      
      Extract target CRM fields for each record:
      - name: Lead's full name (if readable)
      - email: Contact email (if present)
      - phone: Phone number (if present)
      - company: Employer/company name
      - jobTitle: Job role or title
      - revenue: Simple numerical value of deal value/budget (e.g. "$50k" -> "50000")
      - location: Lead's location (city, country, etc.)
      - source: Set this to "AI Unstructured Extraction"
      - status: Set this to "New"
      
      Unstructured data records:
      ${JSON.stringify(rows, null, 2)}

      Return a JSON object in this exact schema:
      {
        "extractedLeads": [
          {
            "name": string,
            "email": string,
            "phone": string,
            "company": string,
            "jobTitle": string,
            "revenue": string,
            "location": string,
            "source": string,
            "status": "New" | "Contacted" | "Qualified" | "Lost"
          },
          ... // matching the input records array
        ]
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const jsonText = response.text();
    const data = JSON.parse(jsonText);
    
    if (data && data.extractedLeads) {
      return data.extractedLeads;
    }
    throw new Error('Invalid JSON format returned from Gemini');
  } catch (error) {
    console.warn('Gemini AI Unstructured Extraction failed, falling back to local regex extraction:', error);
    return parseUnstructuredRowsLocally(rows);
  }
};

export interface AIScoringResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  segment: 'Enterprise' | 'Mid-Market' | 'SMB' | 'Unknown';
  nextAction: string;
}

/**
 * Calculates lead quality score (0-100), tier grade (A-D), corporate segment,
 * and recommends the next best action.
 */
export const calculateLeadScoreAndSegment = (lead: Partial<CRMLead>): AIScoringResult => {
  let score = 0;
  
  // 1. Job Title Scoring (up to 30 pts)
  const title = (lead.jobTitle || '').toLowerCase();
  if (title.includes('ceo') || title.includes('founder') || title.includes('president') || title.includes('co-founder') || title.includes('cfo') || title.includes('cto') || title.includes('coo') || title.includes('cxo') || title.includes('owner')) {
    score += 30;
  } else if (title.includes('vp') || title.includes('vice president') || title.includes('director') || title.includes('head')) {
    score += 20;
  } else if (title.includes('manager') || title.includes('lead') || title.includes('chief')) {
    score += 15;
  } else if (title.includes('engineer') || title.includes('analyst') || title.includes('consultant') || title.includes('associate')) {
    score += 10;
  } else if (title) {
    score += 5;
  }

  // 2. Email Domain Scoring (up to 25 pts)
  const email = (lead.email || '').toLowerCase();
  if (email) {
    const freeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'mail.com', 'zoho.com', 'yandex.com', 'protonmail.com'];
    const domain = email.split('@')[1] || '';
    if (domain) {
      if (freeDomains.includes(domain)) {
        score += 10; // personal/free domain
      } else {
        score += 25; // business/corporate domain
      }
    }
  }

  // 3. Deal Size/Revenue Scoring (up to 30 pts)
  const revVal = parseFloat((lead.revenue || '').replace(/[^0-9.]/g, '')) || 0;
  if (revVal >= 100000) {
    score += 30;
  } else if (revVal >= 50000) {
    score += 20;
  } else if (revVal >= 10000) {
    score += 10;
  } else if (revVal > 0) {
    score += 5;
  }

  // 4. Completeness Scoring (up to 15 pts)
  if (lead.phone && lead.phone.trim()) score += 5;
  if (lead.location && lead.location.trim()) score += 5;
  if (lead.company && lead.company.trim()) score += 5;

  // Cap score at 100
  score = Math.min(score, 100);

  // Determine Grade
  let grade: 'A' | 'B' | 'C' | 'D' = 'D';
  if (score >= 80) grade = 'A';
  else if (score >= 60) grade = 'B';
  else if (score >= 40) grade = 'C';

  // Determine Segment
  let segment: 'Enterprise' | 'Mid-Market' | 'SMB' | 'Unknown' = 'Unknown';
  if (revVal >= 100000) {
    segment = 'Enterprise';
  } else if (revVal >= 25000) {
    segment = 'Mid-Market';
  } else if (revVal > 0) {
    segment = 'SMB';
  } else if (lead.company) {
    segment = 'SMB'; // default if company is present
  }

  // Recommended Next Action
  let nextAction = 'Qualify contact details';
  if (grade === 'A') {
    if (title.includes('ceo') || title.includes('founder') || title.includes('owner')) {
      nextAction = 'Executive outreach: Send custom proposal introducing enterprise integrations';
    } else {
      nextAction = 'High priority: Coordinate a discovery call with engineering heads';
    }
  } else if (grade === 'B') {
    nextAction = 'Product showcase: Send specific case studies and schedule platform demo';
  } else if (grade === 'C') {
    nextAction = 'Nurture: Add to monthly newsletter and automated outreach campaign';
  } else {
    nextAction = 'Profile building: Verify contact credentials and search for phone number';
  }

  return { score, grade, segment, nextAction };
};

/**
 * AI Outreach Email Generator - Tone selection based outreach drafts
 */
export const generateOutreachEmail = async (
  apiKey: string,
  lead: Partial<CRMLead>,
  tone: 'professional' | 'friendly' | 'direct' | 'urgent' = 'professional'
): Promise<string> => {
  if (apiKey.trim()) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
        You are a sales outreach assistant. Write a personalized cold outreach email to this lead:
        Name: ${lead.name}
        Email: ${lead.email}
        Company: ${lead.company || 'their organization'}
        Job Title: ${lead.jobTitle || 'Professional'}
        Estimated Deal Size: $${lead.revenue || 'unspecified'}
        Lead Source: ${lead.source || 'website'}
        Location: ${lead.location || 'unspecified'}
        
        Tone: ${tone}
        
        Instructions:
        1. Write a short, engaging subject line.
        2. Keep the email copy concise (under 150 words).
        3. Personalize it using their job title and company.
        4. Provide a clear call to action (e.g. scheduling a brief 10 min call).
        5. Do not include placeholders like "[Your Name]". Instead, sign off as "Aura Sales Team".
      `;
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.warn('Gemini Email generation failed, using fallback:', error);
    }
  }
  
  // Fallback template generator
  const subjectLines: Record<string, string> = {
    professional: `Exploring collaboration opportunities between Aura and ${lead.company || 'your organization'}`,
    friendly: `Hello ${lead.name ? lead.name.split(' ')[0] : 'there'} - quick question about sales operations at ${lead.company || 'your firm'}`,
    direct: `Improving productivity at ${lead.company || 'your firm'}`,
    urgent: `Urgent: Streamlining pipelines for ${lead.company || 'your firm'}`
  };

  const templates: Record<string, string> = {
    professional: `Subject: ${subjectLines.professional}

Dear ${lead.name || 'Prospect'},

I hope this email finds you well.

I recently came across your profile and noticed your role as ${lead.jobTitle || 'Professional'} at ${lead.company || 'your organization'}. Given your expertise, I thought you might be interested in how we help organizations scale their data management pipelines.

We've recently helped firms similar to ${lead.company || 'yours'} increase deal speeds and data accuracy. I'd love to schedule a brief 10-minute introductory call next week to see if there is a mutual fit.

Best regards,
Aura Sales Team`,
    friendly: `Subject: ${subjectLines.friendly}

Hi ${lead.name ? lead.name.split(' ')[0] : 'there'},

Hope you're having a great week!

I saw that you're working as ${lead.jobTitle || 'Professional'} at ${lead.company || 'your company'} and wanted to reach out. I love what you guys are building there.

We run a data automation platform designed to make CRM importing completely hands-off. Since you manage client relations, I thought this could save you and your team a ton of hours.

Let me know if you have 10 minutes to chat next Tuesday or Thursday!

Cheers,
Aura Sales Team`,
    direct: `Subject: ${subjectLines.direct}

Hi ${lead.name || 'Prospect'},

I'm reaching out because we help ${lead.company || 'organizations'} automate their lead routing and validation processes. 

We can help clean, score, and map your CSV data automatically in seconds. Given your role as ${lead.jobTitle || 'Professional'}, I wanted to see if you'd be open to a quick demonstration.

Are you available for a brief call next Wednesday at 10 AM?

Thanks,
Aura Sales Team`,
    urgent: `Subject: ${subjectLines.urgent}

Dear ${lead.name || 'Prospect'},

With current shifts in CRM management, data accuracy is more critical than ever. 

As ${lead.jobTitle || 'Professional'} at ${lead.company || 'your company'}, ensuring clean pipelines is vital for quarterly targets. We can help you automate lead cleanup and scoring instantly.

Let's coordinate a quick call this week to review how we can support ${lead.company || 'your team'}. Do you have time tomorrow at 2 PM?

Sincerely,
Aura Sales Team`
  };

  return templates[tone] || templates.professional;
};
