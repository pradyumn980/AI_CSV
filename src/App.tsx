import { useState, useEffect } from 'react';
import { parseCSV, parseCSVText } from './utils/csvParser';
import type { CRMLead, ColumnMapping } from './utils/aiService';
import { 
  performAIMapping, 
  performLocalMapping, 
  performAICleaning, 
  cleanLeadDataLocally,
  performAIExtractionUnstructured, 
  validateLead,
  calculateLeadScoreAndSegment,
  TARGET_FIELDS
} from './utils/aiService';
import { Dashboard } from './components/Dashboard';
import { LeadTable } from './components/LeadTable';
import { 
  UploadCloud, 
  Settings, 
  FileSpreadsheet, 
  AlertCircle, 
  CheckCircle2, 
  Download, 
  RefreshCw, 
  FileDown, 
  X, 
  ChevronRight, 
  Info,
  Sliders
} from 'lucide-react';

type ImportStep = 'upload' | 'mapping' | 'review';

function App() {
  // Navigation
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'import'>('dashboard');
  
  // Settings / API Key
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('auracrm_gemini_key') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [testKeyStatus, setTestKeyStatus] = useState<'none' | 'success' | 'failed'>('none');
  
  // Importer Steps State
  const [importStep, setImportStep] = useState<ImportStep>('upload');
  const [isUnstructuredMode, setIsUnstructuredMode] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  
  // Mapping State
  const [columnMappings, setColumnMappings] = useState<Record<string, ColumnMapping>>({});
  const [isMappingLoading, setIsMappingLoading] = useState(false);
  
  // Leads Review State
  const [leadsToReview, setLeadsToReview] = useState<Partial<CRMLead>[]>([]);
  const [isCleaningData, setIsCleaningData] = useState(false);

  // CRM Leads database
  const [leadsDatabase, setLeadsDatabase] = useState<CRMLead[]>(() => {
    const saved = localStorage.getItem('auracrm_leads_db');
    return saved ? JSON.parse(saved) : [];
  });

  // Save CRM Leads to LocalStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('auracrm_leads_db', JSON.stringify(leadsDatabase));
  }, [leadsDatabase]);

  // Handle Save API Key
  const handleSaveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('auracrm_gemini_key', key);
    if (key.trim()) {
      setTestKeyStatus('success');
    } else {
      setTestKeyStatus('none');
    }
  };

  // Test Gemini Connection
  const handleTestApiKey = async () => {
    if (!apiKey.trim()) return;
    setTestKeyStatus('none');
    try {
      // Small test request
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
      });
      if (response.ok) {
        setTestKeyStatus('success');
      } else {
        setTestKeyStatus('failed');
      }
    } catch {
      setTestKeyStatus('failed');
    }
  };

  // File Upload Handlers
  const handleFileUpload = async (file: File) => {
    try {
      setFileName(file.name);
      const parsed = await parseCSV(file);
      setCsvHeaders(parsed.headers);
      setCsvRows(parsed.rows);
    } catch (err) {
      alert('Error parsing CSV file. Make sure it is a valid CSV format.');
      console.error(err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Generate Sample CSV
  const loadSampleCSV = (type: 'clean' | 'messy' | 'unstructured') => {
    let csvText = '';
    let name = '';
    
    if (type === 'clean') {
      name = 'sample_clean_leads.csv';
      csvText = `Lead Name,Email Address,Phone Number,Company Name,Job Title,Deal Value,Lead Source,Location,Lead Status
Alice Johnson,alice@stripe.com,+1-415-555-0101,Stripe,VP of Engineering,85000,LinkedIn,San Francisco,New
Bob Smith,bob@github.com,+1-206-555-0102,GitHub,Director of IT,45000,Web Search,Seattle,Contacted
Carol White,carol@slack.com,,Slack,Head of Sales,120000,Referral,New York,Qualified
Dave Brown,dave@figma.com,+1-310-555-0104,Figma,,28000,Cold outreach,Los Angeles,Lost`;
      setIsUnstructuredMode(false);
    } else if (type === 'messy') {
      name = 'sample_messy_leads.csv';
      csvText = `full_name,mail_addr,phone_no,firm,role,revenue_est,traffic_source,city_state,stage
sarah connor,sarah@skynet.net,555-3829,Skynet,CEO,$150000,outreach,Los Angeles,won
john connor,john@rebellion.org,,Rebellion,Leader,$250k,referral,Mexico,qualified
T-800,t800@cyberdyne.com,1-800-TERMINATOR,Cyberdyne,Infiltrator,,web,,new
ellen ripley,ripley@weyland.com,888-999-2222,Weyland-Yutani,Warrant Officer,$80000,cold_call,Nostromo,lost`;
      setIsUnstructuredMode(false);
    } else {
      name = 'sample_unstructured_leads.csv';
      csvText = `Prospect Details
"Jane Doe (jane.doe@stripe.com, +1-415-555-0120) - VP of Sales at Stripe, SF, est $75,000 deal"
"Mark Zuckerberg - met at TradeShow - CEO @ Meta - mz@meta.com, Menlo Park"
"Bill Gates - Founder at Gates Foundation (bill@gatesfoundation.org) - $500k budget"
"Steve Jobs - cold email, apple - steve@apple.com, Cupertino"`;
      setIsUnstructuredMode(true);
    }

    setFileName(name);
    const parsed = parseCSVText(csvText);
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
  };

  // Run AI/Heuristic mapping and advance to Step 2
  const runColumnMappingAnalysis = async () => {
    if (csvRows.length === 0) {
      alert('Please upload or select a CSV file first.');
      return;
    }

    if (isUnstructuredMode) {
      // Unstructured Mode: Skip mapping wizard, parse data directly
      setIsMappingLoading(true);
      setImportStep('mapping'); // visual step
      
      try {
        let extracted: Partial<CRMLead>[] = [];
        if (apiKey.trim()) {
          extracted = await performAIExtractionUnstructured(apiKey, csvRows);
        } else {
          // Fallback to local regex extractor
          extracted = await performAIExtractionUnstructured('', csvRows);
        }

        // Validate extracted records
        const leads = extracted.map(lead => {
          const validated = {
            ...lead,
            id: crypto.randomUUID(),
            leadScore: 0,
            leadGrade: 'D' as 'A' | 'B' | 'C' | 'D',
            segment: 'Unknown' as 'Enterprise' | 'Mid-Market' | 'SMB' | 'Unknown',
            nextAction: 'Qualify contact details',
            validationErrors: {}
          };
          const scoreResult = calculateLeadScoreAndSegment(validated);
          validated.leadScore = scoreResult.score;
          validated.leadGrade = scoreResult.grade;
          validated.segment = scoreResult.segment;
          validated.nextAction = scoreResult.nextAction;
          validated.validationErrors = validateLead(validated);
          return validated;
        });

        setLeadsToReview(leads);
        setImportStep('review');
      } catch (err) {
        console.error(err);
        alert('Failed parsing unstructured records.');
      } finally {
        setIsMappingLoading(false);
      }
      return;
    }

    // Structured Mode mapping:
    setIsMappingLoading(true);
    setImportStep('mapping');
    
    try {
      let mappings: Record<string, ColumnMapping> = {};
      if (apiKey.trim()) {
        mappings = await performAIMapping(apiKey, csvHeaders, csvRows);
      } else {
        mappings = performLocalMapping(csvHeaders, csvRows);
      }
      setColumnMappings(mappings);
    } catch (err) {
      console.error(err);
      // Fallback
      setColumnMappings(performLocalMapping(csvHeaders, csvRows));
    } finally {
      setIsMappingLoading(false);
    }
  };

  // Apply mapping and create leads array for review
  const applyMappingsAndReview = () => {
    const leads: Partial<CRMLead>[] = csvRows.map((row) => {
      const lead: Partial<CRMLead> = {
        id: crypto.randomUUID(),
        name: '',
        email: '',
        phone: '',
        company: '',
        jobTitle: '',
        revenue: '',
        source: 'CSV Import',
        status: 'New',
        location: '',
        isCleanedByAI: false
      };

      // Map headers to fields
      Object.entries(columnMappings).forEach(([fieldKey, mapping]) => {
        if (mapping.csvHeader && row[mapping.csvHeader] !== undefined) {
          const val = row[mapping.csvHeader].trim();
          
          if (fieldKey === 'name') lead.name = val;
          else if (fieldKey === 'email') lead.email = val;
          else if (fieldKey === 'phone') lead.phone = val;
          else if (fieldKey === 'company') lead.company = val;
          else if (fieldKey === 'jobTitle') lead.jobTitle = val;
          else if (fieldKey === 'revenue') lead.revenue = val;
          else if (fieldKey === 'source') lead.source = val;
          else if (fieldKey === 'status') lead.status = val as any;
          else if (fieldKey === 'location') lead.location = val;
        }
      });

      // Local standardized parsing cleanup for mapped fields
      const cleaned = cleanLeadDataLocally(lead);
      cleaned.id = lead.id;
      
      const scoreResult = calculateLeadScoreAndSegment(cleaned);
      cleaned.leadScore = scoreResult.score;
      cleaned.leadGrade = scoreResult.grade;
      cleaned.segment = scoreResult.segment;
      cleaned.nextAction = scoreResult.nextAction;

      cleaned.validationErrors = validateLead(cleaned);

      return cleaned;
    });

    setLeadsToReview(leads);
    setImportStep('review');
  };

  // Trigger AI Cleanup
  const triggerAICleanup = async () => {
    setIsCleaningData(true);
    try {
      let cleaned: Partial<CRMLead>[] = [];
      if (apiKey.trim()) {
        cleaned = await performAICleaning(apiKey, leadsToReview);
      } else {
        // Fallback local cleanup
        cleaned = leadsToReview.map(lead => {
          const locallyCleaned = cleanLeadDataLocally(lead);
          return {
            ...locallyCleaned,
            id: lead.id,
            isCleanedByAI: false
          };
        });
      }

      // Re-run validation on everything
      const validatedLeads = cleaned.map(lead => {
        const validated = { ...lead };
        const scoreResult = calculateLeadScoreAndSegment(validated);
        validated.leadScore = scoreResult.score;
        validated.leadGrade = scoreResult.grade;
        validated.segment = scoreResult.segment;
        validated.nextAction = scoreResult.nextAction;
        validated.validationErrors = validateLead(validated);
        return validated;
      });

      setLeadsToReview(validatedLeads);
    } catch (err) {
      console.error(err);
      alert('AI cleaning failed. Using local formatting fallback.');
    } finally {
      setIsCleaningData(false);
    }
  };

  // Commit reviewed leads to the leadsDatabase
  const finalizeImport = () => {
    // Filter out rows that have validation errors
    const validLeads = leadsToReview.filter(lead => Object.keys(lead.validationErrors || {}).length === 0) as CRMLead[];
    
    if (validLeads.length === 0) {
      alert('There are no valid leads to import. Please resolve validation errors.');
      return;
    }

    setLeadsDatabase(prev => [...prev, ...validLeads]);
    alert(`Successfully imported ${validLeads.length} leads into the CRM database.`);
    
    // Reset wizard
    setFileName('');
    setCsvHeaders([]);
    setCsvRows([]);
    setColumnMappings({});
    setLeadsToReview([]);
    setImportStep('upload');
    setCurrentTab('dashboard');
  };

  // Clear leads database
  const clearDatabase = () => {
    if (window.confirm('Are you sure you want to delete all CRM leads from the database? This action is irreversible.')) {
      setLeadsDatabase([]);
    }
  };

  // Export database leads as CSV
  const handleExportCSV = () => {
    if (leadsDatabase.length === 0) return;
    
    const headers = ['Lead Name', 'Email', 'Phone', 'Company', 'Job Title', 'Deal Value ($)', 'Source', 'Status', 'Location'];
    const rows = leadsDatabase.map(l => [
      `"${(l.name || '').replace(/"/g, '""')}"`,
      `"${(l.email || '').replace(/"/g, '""')}"`,
      `"${(l.phone || '').replace(/"/g, '""')}"`,
      `"${(l.company || '').replace(/"/g, '""')}"`,
      `"${(l.jobTitle || '').replace(/"/g, '""')}"`,
      `"${l.revenue || ''}"`,
      `"${(l.source || '').replace(/"/g, '""')}"`,
      `"${l.status}"`,
      `"${(l.location || '').replace(/"/g, '""')}"`
    ].join(','));
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `auracrm_leads_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export database leads as JSON
  const handleExportJSON = () => {
    if (leadsDatabase.length === 0) return;
    
    const jsonContent = JSON.stringify(leadsDatabase, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `auracrm_leads_export_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="app-container">
      {/* Navigation Navbar */}
      <nav className="navbar">
        <div className="logo" onClick={() => setCurrentTab('dashboard')} style={{ cursor: 'pointer' }}>
          <div className="logo-icon">A</div>
          <span>AuraCRM</span>
        </div>
        
        <div className="nav-actions">
          <button 
            id="nav-btn-dashboard"
            className={`btn ${currentTab === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setCurrentTab('dashboard')}
            style={{ padding: '0.5rem 1rem' }}
          >
            Dashboard
          </button>
          
          <button 
            id="nav-btn-import"
            className={`btn ${currentTab === 'import' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setCurrentTab('import');
              setImportStep('upload');
            }}
            style={{ padding: '0.5rem 1rem' }}
          >
            Import Leads
          </button>

          {/* Settings Trigger */}
          <button 
            id="btn-settings-toggle"
            className="btn btn-secondary btn-icon"
            onClick={() => setShowSettings(true)}
            title="Configure Gemini API Settings"
            style={{ position: 'relative' }}
          >
            <Settings size={18} />
            {apiKey.trim() && (
              <span 
                style={{ 
                  position: 'absolute', 
                  top: '-2px', 
                  right: '-2px', 
                  width: '8px', 
                  height: '8px', 
                  background: '#10b981', 
                  borderRadius: '50%',
                  boxShadow: '0 0 6px #10b981'
                }} 
              />
            )}
          </button>
        </div>
      </nav>

      {/* Main Container */}
      <main className="main-content">
        
        {currentTab === 'dashboard' ? (
          /* Render Dashboard View */
          <Dashboard 
            leads={leadsDatabase} 
            onNavigateToImport={() => {
              setCurrentTab('import');
              setImportStep('upload');
            }} 
            onClearLeads={clearDatabase}
          />
        ) : (
          /* Render CRM Import Wizard */
          <div>
            {/* Step Wizard Header */}
            <div style={{ maxWidth: '600px', margin: '0 auto 2.5rem auto' }}>
              <div className="wizard-steps">
                <div className={`wizard-step-node ${importStep === 'upload' ? 'wizard-step-active' : ''} ${importStep !== 'upload' ? 'wizard-step-completed' : ''}`}>
                  1
                </div>
                <div className="wizard-step-label" style={{ left: '0', transform: 'translateX(-20%)' }}>Upload CSV</div>

                <div className={`wizard-step-node ${importStep === 'mapping' ? 'wizard-step-active' : ''} ${importStep === 'review' ? 'wizard-step-completed' : ''}`}>
                  2
                </div>
                <div className="wizard-step-label" style={{ left: '50%', transform: 'translateX(-50%)' }}>AI Auto-Map</div>

                <div className={`wizard-step-node ${importStep === 'review' ? 'wizard-step-active' : ''}`}>
                  3
                </div>
                <div className="wizard-step-label" style={{ right: '0', transform: 'translateX(20%)' }}>Verify & Clean</div>
              </div>
            </div>

            {/* Steps Container */}
            {importStep === 'upload' && (
              <div className="glass-card animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto' }}>
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                  <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.5rem' }}>Upload Leads CSV File</h2>
                  <p>Upload your client leads contact sheet. You can use standard files, messy headers, or raw unstructured text.</p>
                </div>

                {/* Upload drag-and-drop zone */}
                <div 
                  id="drop-zone"
                  className="upload-zone"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('csv-file-input')?.click()}
                >
                  <input 
                    id="csv-file-input" 
                    type="file" 
                    accept=".csv" 
                    style={{ display: 'none' }} 
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                    }}
                  />
                  <div className="upload-icon-container">
                    <UploadCloud size={36} />
                  </div>
                  <div>
                    {fileName ? (
                      <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#a855f7' }}>
                        {fileName}
                      </span>
                    ) : (
                      <>
                        <p style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.25rem' }}>
                          Drag & drop your CSV file here, or <span style={{ color: '#8b5cf6' }}>browse</span>
                        </p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Supports standard text CSV, up to 10MB</p>
                      </>
                    )}
                  </div>
                </div>

                {/* File Metadata Details */}
                {csvRows.length > 0 && (
                  <div className="glass-card" style={{ marginTop: '1.5rem', background: 'rgba(255,255,255,0.01)', borderStyle: 'dotted', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <FileSpreadsheet size={24} style={{ color: '#06b6d4' }} />
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>File Analyzed</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {csvHeaders.length} Columns • {csvRows.length} Rows Detected
                        </span>
                      </div>
                    </div>

                    {/* Structured/Unstructured Toggles */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label className="switch">
                          <input 
                            id="toggle-unstructured"
                            type="checkbox" 
                            checked={isUnstructuredMode}
                            onChange={(e) => setIsUnstructuredMode(e.target.checked)}
                          />
                          <span className="slider"></span>
                        </label>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          Unstructured File Mode
                          <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} title="Enable this if the CSV does not contain distinct columns, but has a single description column of contact details. Requires Gemini API Key for best results.">
                            <Info size={12} />
                          </span>
                        </span>
                      </div>

                      <button id="btn-analyze-csv" className="btn btn-primary" onClick={runColumnMappingAnalysis}>
                        Analyze & Map
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Sample Templates Loader */}
                <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem', textAlign: 'center' }}>
                    Or try a demo template format:
                  </h4>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button id="btn-sample-clean" className="btn btn-secondary" onClick={() => loadSampleCSV('clean')}>
                      Standard Clean CSV
                    </button>
                    <button id="btn-sample-messy" className="btn btn-secondary" onClick={() => loadSampleCSV('messy')}>
                      Messy Headers CSV
                    </button>
                    <button id="btn-sample-unstructured" className="btn btn-secondary" onClick={() => loadSampleCSV('unstructured')}>
                      Unstructured Row CSV
                    </button>
                  </div>
                </div>
              </div>
            )}

            {importStep === 'mapping' && (
              <div className="glass-card animate-fade-in">
                {isMappingLoading ? (
                  /* Loading Spinner */
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem 0', gap: '1.5rem' }}>
                    <RefreshCw size={40} className="animate-pulse" style={{ color: '#8b5cf6' }} />
                    <div style={{ textAlign: 'center' }}>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>Analyzing CSV Structure...</h3>
                      <p>Sniffing column patterns and generating mapping correlations.</p>
                    </div>
                  </div>
                ) : (
                  /* Mappings Wizard View */
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                      <div>
                        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, background: 'var(--primary-glow)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '0.25rem' }}>
                          AI Header Mapping Suggestion
                        </h2>
                        <p>Verify how we mapped the CSV fields to the CRM Lead database fields.</p>
                      </div>

                      {apiKey.trim() ? (
                        <div className="ai-status-glow">
                          <div className="ai-status-dot"></div>
                          <span>Gemini Mapping Active</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245,158,11,0.2)', padding: '0.4rem 0.8rem', borderRadius: '20px', fontSize: '0.8rem', color: '#fcd34d' }}>
                          <span>Local Heuristic Mapping Active</span>
                        </div>
                      )}
                    </div>

                    {/* Columns List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' }}>
                      <div className="mapping-grid" style={{ marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                        <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Standard CRM Field</span>
                        <span style={{ textAlign: 'center', fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Match Status</span>
                        <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Source CSV Column</span>
                      </div>

                      {TARGET_FIELDS.map((target) => {
                        const mapping = columnMappings[target.key] || { csvHeader: null, confidence: 'none', reason: 'Unmapped' };
                        
                        const statusColors: Record<string, string> = {
                          high: 'badge-success',
                          medium: 'badge-warning',
                          low: 'badge-danger',
                          none: 'badge-secondary'
                        };

                        return (
                          <div key={target.key} className="mapping-grid">
                            {/* Target Card */}
                            <div className="mapping-card mapping-target-card">
                              <div>
                                <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{target.label}</span>
                                {target.required && <span style={{ color: 'var(--color-danger)', marginLeft: '4px' }}>*</span>}
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{target.description}</p>
                              </div>
                            </div>

                            {/* Match Confidence Indicator */}
                            <div className="mapping-connector mapping-connector-active">
                              <span className={`badge ${statusColors[mapping.confidence]}`} title={mapping.reason}>
                                {mapping.confidence}
                              </span>
                              <div className="mapping-connector-line"></div>
                            </div>

                            {/* Dropdown Selector */}
                            <div className="mapping-card mapping-source-card">
                              <select 
                                id={`select-mapping-${target.key}`}
                                className="glass-input glass-select"
                                value={mapping.csvHeader || ''}
                                onChange={(e) => {
                                  const val = e.target.value || null;
                                  setColumnMappings(prev => ({
                                    ...prev,
                                    [target.key]: {
                                      csvHeader: val,
                                      confidence: val ? 'high' : 'none',
                                      reason: val ? 'Manually selected mapping' : 'Unmapped'
                                    }
                                  }));
                                }}
                                style={{ padding: '0.5rem 2rem 0.5rem 0.75rem' }}
                              >
                                <option value="">-- Do Not Import / Map --</option>
                                {csvHeaders.map(header => (
                                  <option key={header} value={header}>{header}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Mapping Wizard Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
                      <button id="btn-mapping-back" className="btn btn-secondary" onClick={() => setImportStep('upload')}>
                        Back to Upload
                      </button>
                      <button id="btn-apply-mappings" className="btn btn-primary" onClick={applyMappingsAndReview}>
                        Apply Mapping & Review
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {importStep === 'review' && (
              <LeadTable 
                leads={leadsToReview}
                onUpdateLeads={setLeadsToReview}
                onPrevStep={() => {
                  if (isUnstructuredMode) {
                    setImportStep('upload'); // unstructured bypasses mapping wizard
                  } else {
                    setImportStep('mapping');
                  }
                }}
                onFinalizeImport={finalizeImport}
                isCleaning={isCleaningData}
                onTriggerAIClean={triggerAICleanup}
                hasApiKey={apiKey.trim().length > 0}
              />
            )}
          </div>
        )}
      </main>

      {/* Settings Dialog Modal overlay */}
      {showSettings && (
        <div className="overlay animate-fade-in" onClick={() => setShowSettings(false)}>
          <div className="glass-card modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.35rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sliders size={20} style={{ color: '#8b5cf6' }} />
                Gemini AI Configuration
              </h3>
              <button 
                id="btn-settings-close"
                className="btn btn-secondary btn-icon" 
                onClick={() => setShowSettings(false)}
                style={{ padding: '0.25rem' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="input-gemini-key">Google Gemini API Key</label>
              <input 
                id="input-gemini-key"
                type="password" 
                placeholder="AIzaSy..." 
                className="glass-input"
                value={apiKey}
                onChange={(e) => handleSaveApiKey(e.target.value)}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                The key is saved in your local browser storage and is never uploaded.
              </p>
            </div>

            {/* Test connection results */}
            {apiKey.trim() && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {testKeyStatus === 'success' && <CheckCircle2 size={16} style={{ color: '#10b981' }} />}
                  {testKeyStatus === 'failed' && <AlertCircle size={16} style={{ color: '#ef4444' }} />}
                  Connection Status: {testKeyStatus === 'success' ? 'Active' : testKeyStatus === 'failed' ? 'Connection Failed' : 'Untested'}
                </span>
                <button 
                  id="btn-test-key"
                  className="btn btn-secondary" 
                  onClick={handleTestApiKey}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                >
                  Test Key
                </button>
              </div>
            )}

            <button 
              id="btn-settings-save"
              className="btn btn-primary" 
              onClick={() => setShowSettings(false)}
              style={{ width: '100%' }}
            >
              Done
            </button>
          </div>
        </div>
      )}
      
      {/* Footer details */}
      <footer style={{ borderTop: '1px solid var(--border-color)', padding: '1.5rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', background: 'rgba(7, 8, 13, 0.4)' }}>
        <span>AuraCRM Importer v1.0.0 © 2026. Powered by local heuristics & Google Gemini.</span>
        {leadsDatabase.length > 0 && (
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button id="btn-export-csv" className="btn btn-secondary" onClick={handleExportCSV} style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}>
              <Download size={12} />
              Export CRM DB to CSV
            </button>
            <button id="btn-export-json" className="btn btn-secondary" onClick={handleExportJSON} style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}>
              <FileDown size={12} />
              Export CRM DB to JSON
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

export default App;
