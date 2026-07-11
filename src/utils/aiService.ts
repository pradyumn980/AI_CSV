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
