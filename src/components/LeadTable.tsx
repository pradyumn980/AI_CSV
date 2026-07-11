import React, { useState } from 'react';
import type { CRMLead } from '../utils/aiService';
import { validateLead } from '../utils/aiService';
import { 
  Search, 
  Trash2, 
  Plus, 
  AlertTriangle, 
  Check, 
  Sparkles, 
  ArrowLeft, 
  ArrowRight,
  Database
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

  // Local helper to update a field in a lead row
  const updateLeadField = (index: number, field: keyof CRMLead, value: string) => {
    const updatedLeads = [...leads];
    const updatedLead = { ...updatedLeads[index], [field]: value };
    
    // Re-run validation
    updatedLead.validationErrors = validateLead(updatedLead);
    
    updatedLeads[index] = updatedLead;
    onUpdateLeads(updatedLeads);
  };

  // Start cell editing
  const startEditing = (index: number, field: keyof CRMLead, currentValue: string) => {
    // Don't edit metadata fields
    if (field === 'validationErrors' || field === 'id' || field === 'isCleanedByAI') return;
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

      {/* Editor Grid Table */}
      <div className="table-container" style={{ maxHeight: '550px', overflowY: 'auto' }}>
        <table className="review-table">
          <thead>
            <tr>
              <th style={{ width: '50px' }}>Actions</th>
              <th>Status</th>
              <th>Lead Name *</th>
              <th>Email Address *</th>
              <th>Phone Number</th>
              <th>Company</th>
              <th>Job Title</th>
              <th>Est. Deal Size ($)</th>
              <th>Source</th>
              <th>Lead Stage</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
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
    </div>
  );
};
