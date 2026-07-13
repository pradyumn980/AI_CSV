import React, { useState } from 'react';
import type { CRMLead } from '../utils/aiService';
import { validateLead, calculateLeadScoreAndSegment, generateOutreachEmail } from '../utils/aiService';
import { 
  Search, 
  Trash2, 
  Plus, 
  AlertTriangle, 
  Check, 
  Sparkles, 
  ArrowLeft, 
  ArrowRight,
  Database,
  Mail,
  Copy,
  CheckCircle2,
  X
} from 'lucide-react';

interface LeadTableProps {
  leads: Partial<CRMLead>[];
  onUpdateLeads: (leads: Partial<CRMLead>[]) => void;
  onPrevStep: () => void;
  onFinalizeImport: () => void;
  isCleaning: boolean;
  onTriggerAIClean: () => void;
  hasApiKey: boolean;
}

export const LeadTable: React.FC<LeadTableProps> = ({
  leads,
  onUpdateLeads,
  onPrevStep,
  onFinalizeImport,
  isCleaning,
  onTriggerAIClean,
  hasApiKey
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'valid' | 'invalid' | 'missing'>('all');
  const [editingCell, setEditingCell] = useState<{ index: number; field: keyof CRMLead } | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // AI Modal States
  const [showOutreach, setShowOutreach] = useState(false);
  const [selectedLeadForEmail, setSelectedLeadForEmail] = useState<Partial<CRMLead> | null>(null);
  const [emailTone, setEmailTone] = useState<'professional' | 'friendly' | 'direct' | 'urgent'>('professional');
  const [emailDraft, setEmailDraft] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const [copied, setCopied] = useState(false);

  const openOutreachModal = async (lead: Partial<CRMLead>) => {
    setSelectedLeadForEmail(lead);
    setShowOutreach(true);
    setEmailTone('professional');
    await generateDraftForTone(lead, 'professional');
  };

  const generateDraftForTone = async (lead: Partial<CRMLead>, tone: 'professional' | 'friendly' | 'direct' | 'urgent') => {
    setIsGeneratingEmail(true);
    setCopied(false);
    try {
      const key = localStorage.getItem('auracrm_gemini_key') || '';
      const draft = await generateOutreachEmail(key, lead, tone);
      setEmailDraft(draft);
    } catch (err) {
      console.error(err);
      setEmailDraft('Error generating email draft.');
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  // Local helper to update a field in a lead row
  const updateLeadField = (index: number, field: keyof CRMLead, value: string) => {
    const updatedLeads = [...leads];
    const updatedLead = { ...updatedLeads[index], [field]: value };
    
    // Recalculate AI score
    const aiResult = calculateLeadScoreAndSegment(updatedLead);
    updatedLead.leadScore = aiResult.score;
    updatedLead.leadGrade = aiResult.grade;
    updatedLead.segment = aiResult.segment;
    updatedLead.nextAction = aiResult.nextAction;

    // Re-run validation
    updatedLead.validationErrors = validateLead(updatedLead);
    
    updatedLeads[index] = updatedLead;
    onUpdateLeads(updatedLeads);
  };

  // Start cell editing
  const startEditing = (index: number, field: keyof CRMLead, currentValue: string) => {
    // Don't edit metadata fields or scores directly
    if (field === 'validationErrors' || field === 'id' || field === 'isCleanedByAI' || field === 'leadScore' || field === 'leadGrade' || field === 'segment' || field === 'nextAction') return;
    setEditingCell({ index, field });
    setEditingValue(currentValue || '');
  };

  // Save cell edit
  const saveEdit = () => {
    if (editingCell) {
      updateLeadField(editingCell.index, editingCell.field, editingValue);
      setEditingCell(null);
    }
  };

  // Handle cell key presses (Enter to save, Esc to cancel)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  // Add a new blank lead row
  const handleAddRow = () => {
    const newLead: Partial<CRMLead> = {
      name: '',
      email: '',
      phone: '',
      company: '',
      jobTitle: '',
      revenue: '',
      source: 'Manual Entry',
      status: 'New',
      location: '',
      leadScore: 0,
      leadGrade: 'D',
      segment: 'Unknown',
      nextAction: 'Qualify contact details',
      validationErrors: {
        name: 'Lead Name is required',
        email: 'Email Address is required'
      }
    };
    onUpdateLeads([newLead, ...leads]);
  };

  // Delete a specific lead row
  const handleDeleteRow = (index: number) => {
    const updated = leads.filter((_, idx) => idx !== index);
    onUpdateLeads(updated);
  };

  // Count leads by category
  const counts = leads.reduce(
    (acc, lead) => {
      const hasErrors = Object.keys(lead.validationErrors || {}).length > 0;
      const isMissingOptional = !lead.phone || !lead.company || !lead.jobTitle || !lead.revenue || !lead.location;
      
      if (hasErrors) acc.invalid++;
      else acc.valid++;
      
      if (isMissingOptional) acc.missing++;
      
      return acc;
    },
    { valid: 0, invalid: 0, missing: 0 }
  );

  // Filter and search logic
  const filteredLeads = leads
    .map((lead, index) => ({ ...lead, originalIndex: index }))
    .filter(({ name, email, company, jobTitle, validationErrors }) => {
      // 1. Search Query filter
      const matchesSearch = 
        (name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (company || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (jobTitle || '').toLowerCase().includes(searchQuery.toLowerCase());
        
      if (!matchesSearch) return false;

      // 2. Tab filter
      const hasErrors = Object.keys(validationErrors || {}).length > 0;
      
      if (filterTab === 'valid') return !hasErrors;
      if (filterTab === 'invalid') return hasErrors;
      if (filterTab === 'missing') {
        // Check actual missing fields in this lead
        const missingFields = !name || !email || !company || !jobTitle;
        return missingFields;
      }
      
      return true;
    });

  // Deduplication check: group by email and find duplicates in this batch
  const emailGroups = leads.reduce((acc, lead) => {
    if (lead.email) {
      const email = lead.email.toLowerCase().trim();
      acc[email] = (acc[email] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const duplicateEmails = Object.entries(emailGroups)
    .filter(([_, count]) => count > 1)
    .map(([email]) => email);

  const duplicatesCount = duplicateEmails.length;

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, background: 'var(--primary-glow)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '0.25rem' }}>
            Verify & Clean Lead Data
          </h2>
          <p>Double-click any cell to edit in-line. We will dynamically validate your changes.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            id="btn-ai-clean"
            className="btn btn-secondary" 
            onClick={onTriggerAIClean}
            disabled={isCleaning}
            style={{ borderColor: 'rgba(139, 92, 246, 0.4)', background: 'rgba(139, 92, 246, 0.05)', color: '#c084fc' }}
          >
            <Sparkles size={16} className={isCleaning ? 'animate-pulse' : ''} />
            {isCleaning ? 'AI Cleaning...' : hasApiKey ? 'Clean Data with AI' : 'Smart Standardize Data'}
          </button>
          
          <button id="btn-add-row" className="btn btn-secondary" onClick={handleAddRow}>
            <Plus size={16} />
            Add Row
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="glass-card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        {/* Search */}
        <div style={{ position: 'relative', width: '300px' }}>
          <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            id="input-lead-search"
            type="text" 
            placeholder="Search leads..." 
            className="glass-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            id="tab-filter-all"
            className={`btn ${filterTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterTab('all')}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            All ({leads.length})
          </button>
          
          <button 
            id="tab-filter-valid"
            className={`btn ${filterTab === 'valid' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterTab('valid')}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            <Check size={14} style={{ marginRight: '0.25rem', color: filterTab === 'valid' ? '#fff' : '#10b981' }} />
            Valid ({counts.valid})
          </button>
          
          <button 
            id="tab-filter-invalid"
            className={`btn ${filterTab === 'invalid' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterTab('invalid')}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
            disabled={counts.invalid === 0}
          >
            <AlertTriangle size={14} style={{ marginRight: '0.25rem', color: filterTab === 'invalid' ? '#fff' : '#ef4444' }} />
            Errors ({counts.invalid})
          </button>
        </div>
      </div>

      {/* Deduplication Banner */}
      {duplicatesCount > 0 && (
        <div 
          className="glass-card duplicate-banner animate-fade-in" 
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: '1rem 1.5rem', 
            marginBottom: '1.5rem', 
            borderLeft: '4px solid var(--color-warning)', 
            background: 'rgba(245, 158, 11, 0.03)' 
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ color: 'var(--color-warning)' }}><AlertTriangle size={20} /></span>
            <div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Duplicate Records Detected</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0 0' }}>
                We found {duplicatesCount} duplicate email address{duplicatesCount > 1 ? 'es' : ''} in this batch.
              </p>
            </div>
          </div>
          <button 
            id="btn-merge-duplicates"
            className="btn btn-secondary" 
            onClick={() => {
              const seen = new Set<string>();
              const uniqueLeads = leads.filter(lead => {
                if (!lead.email) return true;
                const email = lead.email.toLowerCase().trim();
                if (seen.has(email)) return false;
                seen.add(email);
                return true;
              });
              onUpdateLeads(uniqueLeads);
            }}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
          >
            Merge duplicates
          </button>
        </div>
      )}

      {/* Editor Grid Table */}
      <div className="table-container" style={{ maxHeight: '550px', overflowY: 'auto' }}>
        <table className="review-table">
          <thead>
            <tr>
              <th style={{ width: '50px' }}>Actions</th>
              <th>Status</th>
              <th>AI Grade</th>
              <th>Segment</th>
              <th>Lead Name *</th>
              <th>Email Address *</th>
              <th>Phone Number</th>
              <th>Company</th>
              <th>Job Title</th>
              <th>Est. Deal Size ($)</th>
              <th>Recommended Action</th>
              <th>Outreach</th>
              <th>Source</th>
              <th>Lead Stage</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.length === 0 ? (
              <tr>
                <td colSpan={15} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No leads matching the active filters.
                </td>
              </tr>
            ) : (
              filteredLeads.map((lead) => {
                const globalIdx = lead.originalIndex;
                const hasErrors = Object.keys(lead.validationErrors || {}).length > 0;
                
                return (
                  <tr key={globalIdx} className={hasErrors ? 'row-invalid' : ''}>
                    {/* Actions */}
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        id={`btn-delete-row-${globalIdx}`}
                        className="btn btn-secondary btn-danger btn-icon" 
                        onClick={() => handleDeleteRow(globalIdx)}
                        title="Delete lead record"
                        style={{ padding: '0.35rem' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>

                    {/* Status Badge */}
                    <td>
                      {hasErrors ? (
                        <span className="badge badge-danger" title={Object.values(lead.validationErrors || {}).join(', ')}>
                          <AlertTriangle size={12} style={{ marginRight: '2px' }} />
                          Invalid
                        </span>
                      ) : (
                        <span className="badge badge-success">
                          <Check size={12} style={{ marginRight: '2px' }} />
                          Valid
                        </span>
                      )}
                      {lead.isCleanedByAI && (
                        <span className="badge badge-info" style={{ marginLeft: '4px', fontSize: '0.65rem' }}>
                          AI Cleaned
                        </span>
                      )}
                    </td>

                    {/* AI Grade */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: '95px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'space-between' }}>
                          <span className={`badge badge-grade-${lead.leadGrade || 'D'}`}>
                            Grade {lead.leadGrade || 'D'}
                          </span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                            {lead.leadScore || 0}%
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div 
                            style={{ 
                              height: '100%', 
                              width: `${lead.leadScore || 0}%`, 
                              background: (lead.leadScore || 0) >= 80 ? 'var(--color-success)' : (lead.leadScore || 0) >= 60 ? 'var(--color-info)' : (lead.leadScore || 0) >= 40 ? 'var(--color-warning)' : 'var(--color-danger)'
                            }} 
                          />
                        </div>
                      </div>
                    </td>

                    {/* Segment */}
                    <td>
                      <span className={`badge badge-segment-${(lead.segment || 'Unknown').toLowerCase()}`}>
                        {lead.segment || 'Unknown'}
                      </span>
                    </td>

                    {/* Name */}
                    <td 
                      id={`cell-name-${globalIdx}`}
                      className="cell-editable"
                      onClick={() => startEditing(globalIdx, 'name', lead.name || '')}
                    >
                      {editingCell?.index === globalIdx && editingCell?.field === 'name' ? (
                        <input 
                          autoFocus
                          type="text"
                          className="cell-editable-input"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={handleKeyDown}
                        />
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          {lead.name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Double-click to set name</span>}
                          {lead.validationErrors?.name && (
                            <span title={lead.validationErrors.name} style={{ display: 'inline-flex' }}>
                              <AlertTriangle size={12} style={{ color: 'var(--color-danger)' }} />
                            </span>
                          )}
                        </span>
                      )}
                    </td>

                    {/* Email */}
                    <td 
                      id={`cell-email-${globalIdx}`}
                      className="cell-editable"
                      onClick={() => startEditing(globalIdx, 'email', lead.email || '')}
                    >
                      {editingCell?.index === globalIdx && editingCell?.field === 'email' ? (
                        <input 
                          autoFocus
                          type="text"
                          className="cell-editable-input"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={handleKeyDown}
                        />
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          {lead.email || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Double-click to set email</span>}
                          {lead.validationErrors?.email && (
                            <span title={lead.validationErrors.email} style={{ display: 'inline-flex' }}>
                              <AlertTriangle size={12} style={{ color: 'var(--color-danger)' }} />
                            </span>
                          )}
                        </span>
                      )}
                    </td>

                    {/* Phone */}
                    <td 
                      id={`cell-phone-${globalIdx}`}
                      className="cell-editable"
                      onClick={() => startEditing(globalIdx, 'phone', lead.phone || '')}
                    >
                      {editingCell?.index === globalIdx && editingCell?.field === 'phone' ? (
                        <input 
                          autoFocus
                          type="text"
                          className="cell-editable-input"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={handleKeyDown}
                        />
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          {lead.phone || <span style={{ color: 'var(--text-muted)' }}>-</span>}
                          {lead.validationErrors?.phone && (
                            <span title={lead.validationErrors.phone} style={{ display: 'inline-flex' }}>
                              <AlertTriangle size={12} style={{ color: 'var(--color-warning)' }} />
                            </span>
                          )}
                        </span>
                      )}
                    </td>

                    {/* Company */}
                    <td 
                      id={`cell-company-${globalIdx}`}
                      className="cell-editable"
                      onClick={() => startEditing(globalIdx, 'company', lead.company || '')}
                    >
                      {editingCell?.index === globalIdx && editingCell?.field === 'company' ? (
                        <input 
                          autoFocus
                          type="text"
                          className="cell-editable-input"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={handleKeyDown}
                        />
                      ) : (
                        lead.company || <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>

                    {/* Job Title */}
                    <td 
                      id={`cell-jobTitle-${globalIdx}`}
                      className="cell-editable"
                      onClick={() => startEditing(globalIdx, 'jobTitle', lead.jobTitle || '')}
                    >
                      {editingCell?.index === globalIdx && editingCell?.field === 'jobTitle' ? (
                        <input 
                          autoFocus
                          type="text"
                          className="cell-editable-input"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={handleKeyDown}
                        />
                      ) : (
                        lead.jobTitle || <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>

                    {/* Revenue */}
                    <td 
                      id={`cell-revenue-${globalIdx}`}
                      className="cell-editable"
                      onClick={() => startEditing(globalIdx, 'revenue', lead.revenue || '')}
                    >
                      {editingCell?.index === globalIdx && editingCell?.field === 'revenue' ? (
                        <input 
                          autoFocus
                          type="text"
                          className="cell-editable-input"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={handleKeyDown}
                        />
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          {lead.revenue ? `$${parseFloat(lead.revenue).toLocaleString()}` : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                          {lead.validationErrors?.revenue && (
                            <span title={lead.validationErrors.revenue} style={{ display: 'inline-flex' }}>
                              <AlertTriangle size={12} style={{ color: 'var(--color-danger)' }} />
                            </span>
                          )}
                        </span>
                      )}
                    </td>

                    {/* Recommended Action */}
                    <td>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'normal', display: 'block', maxWidth: '200px' }}>
                        {lead.nextAction || 'Qualify details'}
                      </span>
                    </td>

                    {/* Outreach */}
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        id={`btn-outreach-${globalIdx}`}
                        className="btn btn-secondary btn-icon" 
                        onClick={() => openOutreachModal(lead)}
                        title="Generate AI Outreach Email"
                        style={{ padding: '0.35rem', borderColor: 'rgba(139, 92, 246, 0.3)', color: '#c084fc', background: 'rgba(139,92,246,0.02)' }}
                        disabled={!lead.email || !!lead.validationErrors?.email}
                      >
                        <Mail size={14} />
                      </button>
                    </td>

                    {/* Source */}
                    <td 
                      id={`cell-source-${globalIdx}`}
                      className="cell-editable"
                      onClick={() => startEditing(globalIdx, 'source', lead.source || '')}
                    >
                      {editingCell?.index === globalIdx && editingCell?.field === 'source' ? (
                        <input 
                          autoFocus
                          type="text"
                          className="cell-editable-input"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={handleKeyDown}
                        />
                      ) : (
                        lead.source || <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>

                    {/* Status */}
                    <td id={`cell-status-${globalIdx}`}>
                      <select
                        id={`select-status-${globalIdx}`}
                        className="glass-input glass-select"
                        value={lead.status || 'New'}
                        onChange={(e) => updateLeadField(globalIdx, 'status', e.target.value)}
                        style={{ padding: '0.25rem 2rem 0.25rem 0.5rem', width: 'auto', fontSize: '0.85rem' }}
                      >
                        <option value="New">New</option>
                        <option value="Contacted">Contacted</option>
                        <option value="Qualified">Qualified</option>
                        <option value="Lost">Lost</option>
                      </select>
                    </td>

                    {/* Location */}
                    <td 
                      id={`cell-location-${globalIdx}`}
                      className="cell-editable"
                      onClick={() => startEditing(globalIdx, 'location', lead.location || '')}
                    >
                      {editingCell?.index === globalIdx && editingCell?.field === 'location' ? (
                        <input 
                          autoFocus
                          type="text"
                          className="cell-editable-input"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={handleKeyDown}
                        />
                      ) : (
                        lead.location || <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Navigation Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
        <button id="btn-editor-back" className="btn btn-secondary" onClick={onPrevStep}>
          <ArrowLeft size={16} />
          Back to Mapping
        </button>

        <button 
          id="btn-editor-finalize"
          className={`btn btn-primary ${counts.invalid > 0 ? 'btn-disabled' : ''}`} 
          onClick={onFinalizeImport}
          disabled={counts.invalid > 0}
          title={counts.invalid > 0 ? 'Please resolve all validation errors before importing' : ''}
        >
          <Database size={16} />
          Finalize Import ({leads.length} Leads)
          <ArrowRight size={16} />
        </button>
      </div>

      {/* AI Email Outreach Modal */}
      {showOutreach && selectedLeadForEmail && (
        <div className="modal-overlay animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.65)', zIndex: 1000, backdropFilter: 'blur(8px)' }}>
          <div className="glass-card modal-container animate-scale-up" style={{ width: '90%', maxWidth: '650px', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', border: '1px solid rgba(255, 255, 255, 0.1)', boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={20} style={{ color: '#c084fc' }} />
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>AI Lead Outreach Assistant</h3>
              </div>
              <button 
                id="btn-close-outreach"
                className="btn btn-secondary btn-icon" 
                onClick={() => setShowOutreach(false)}
                style={{ padding: '0.25rem', border: 'none', background: 'none', color: 'var(--text-secondary)' }}
              >
                <X size={18} />
              </button>
            </div>
            
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Drafting personalized outreach to <strong>{selectedLeadForEmail.name}</strong> ({selectedLeadForEmail.jobTitle || 'Prospect'} at {selectedLeadForEmail.company || 'Unknown Company'}).
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Outreach Tone</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['professional', 'friendly', 'direct', 'urgent'] as const).map((tone) => (
                  <button
                    key={tone}
                    id={`btn-tone-${tone}`}
                    className={`btn ${emailTone === tone ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => {
                      setEmailTone(tone);
                      generateDraftForTone(selectedLeadForEmail, tone);
                    }}
                    style={{ textTransform: 'capitalize', fontSize: '0.8rem', padding: '0.4rem 0.8rem', flex: 1 }}
                  >
                    {tone}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, minHeight: '200px', display: 'flex', flexDirection: 'column' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Generated Outreach Email</label>
              {isGeneratingEmail ? (
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-secondary)', fontSize: '0.9rem', height: '220px' }}>
                  <span className="spinner" style={{ marginRight: '0.5rem' }}></span>
                  Generating customized email draft...
                </div>
              ) : (
                <textarea
                  id="textarea-email-draft"
                  className="glass-input"
                  style={{ flex: 1, width: '100%', height: '220px', fontFamily: 'monospace', fontSize: '0.85rem', padding: '0.75rem', resize: 'none', lineHeight: '1.4' }}
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                />
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button 
                id="btn-outreach-copy"
                className="btn btn-secondary" 
                onClick={() => {
                  navigator.clipboard.writeText(emailDraft);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                disabled={isGeneratingEmail}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                {copied ? <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} /> : <Copy size={16} />}
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <button 
                id="btn-outreach-send"
                className="btn btn-primary" 
                onClick={() => {
                  window.open(`mailto:${selectedLeadForEmail.email}?subject=${encodeURIComponent(emailDraft.split('\n')[0].replace('Subject: ', ''))}&body=${encodeURIComponent(emailDraft.split('\n').slice(2).join('\n'))}`);
                  setShowOutreach(false);
                }}
                disabled={isGeneratingEmail}
              >
                Send Outreach
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
