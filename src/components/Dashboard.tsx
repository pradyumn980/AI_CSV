import type { CRMLead } from '../utils/aiService';
import { 
  Users, 
  DollarSign, 
  TrendingUp, 
  MapPin, 
  BarChart2, 
  ShieldAlert, 
  CheckCircle,
  FolderOpen
} from 'lucide-react';

interface DashboardProps {
  leads: CRMLead[];
  onNavigateToImport: () => void;
  onClearLeads: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
  leads, 
  onNavigateToImport, 
  onClearLeads 
}) => {
  // Calculations
  const totalLeads = leads.length;
  
  const pipelineValue = leads.reduce((sum, lead) => {
    const val = parseFloat(lead.revenue.replace(/[^0-9.]/g, '')) || 0;
    return sum + val;
  }, 0);

  const validLeads = leads.filter(lead => Object.keys(lead.validationErrors).length === 0).length;
  const validationRate = totalLeads > 0 ? Math.round((validLeads / totalLeads) * 100) : 0;

  // Source distribution
  const sourceCounts = leads.reduce((acc, lead) => {
    const src = lead.source || 'Unknown';
    acc[src] = (acc[src] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topSource = Object.entries(sourceCounts).reduce(
    (top, [src, count]) => count > top.count ? { src, count } : top,
    { src: 'None', count: 0 }
  ).src;

  // Status counts
  const statusCounts = leads.reduce((acc, lead) => {
    const status = lead.status || 'New';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { 'New': 0, 'Contacted': 0, 'Qualified': 0, 'Lost': 0 } as Record<string, number>);

  // Render SVG Donut Chart for Status
  const renderStatusDonut = () => {
    const statuses = Object.entries(statusCounts);
    const total = totalLeads;
    if (total === 0) return null;

    let accumulatedAngle = 0;
    const radius = 60;
    const strokeWidth = 14;
    const center = 80;
    const circumference = 2 * Math.PI * radius;

    const colors: Record<string, string> = {
      'New': '#3b82f6',       // Blue
      'Contacted': '#f59e0b', // Orange
      'Qualified': '#10b981', // Green
      'Lost': '#ef4444'       // Red
    };

    return (
      <svg width="180" height="180" viewBox="0 0 160 160">
        <circle cx={center} cy={center} r={radius} fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth={strokeWidth} />
        {statuses.map(([status, count]) => {
          if (count === 0) return null;
          const percentage = count / total;
          const strokeLength = percentage * circumference;
          const strokeOffset = circumference - strokeLength + accumulatedAngle;
          accumulatedAngle -= strokeLength;

          return (
            <circle
              key={status}
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke={colors[status]}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeOffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${center} ${center})`}
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}
            />
          );
        })}
        <text x={center} y={center - 5} textAnchor="middle" fill="var(--text-primary)" fontSize="18" fontWeight="bold" fontFamily="var(--font-heading)">
          {total}
        </text>
        <text x={center} y={center + 15} textAnchor="middle" fill="var(--text-secondary)" fontSize="10" fontWeight="600" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Leads
        </text>
      </svg>
    );
  };

  // Render SVG Bar Chart for Sources
  const renderSourceBarChart = () => {
    const sources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5); // top 5 sources
    
    if (sources.length === 0) return null;
    const maxCount = Math.max(...sources.map(([_, count]) => count));

    return (
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {sources.map(([source, count]) => {
          const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
          return (
            <div key={source} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{source}</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: '600' }}>
                  {count} ({Math.round((count / totalLeads) * 100)}%)
                </span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                <div 
                  style={{ 
                    height: '100%', 
                    width: `${pct}%`, 
                    background: 'var(--primary-glow)',
                    borderRadius: '4px',
                    transition: 'width 0.8s ease'
                  }} 
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="animate-fade-in">
      {/* Welcome Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2.25rem', fontWeight: 800, background: 'var(--primary-glow)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '0.5rem' }}>
            AuraCRM Dashboard
          </h1>
          <p>Real-time analytics and data intelligence for your imported leads.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {totalLeads > 0 && (
            <button id="btn-clear-db" className="btn btn-secondary btn-danger" onClick={onClearLeads}>
              Clear Database
            </button>
          )}
          <button id="btn-import-leads" className="btn btn-primary" onClick={onNavigateToImport}>
            <FolderOpen size={18} />
            Import CSV File
          </button>
        </div>
      </div>

      {totalLeads === 0 ? (
        /* Empty State */
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem 2rem', textAlign: 'center', gap: '1.5rem' }}>
          <div style={{ width: '5rem', height: '5rem', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
            <Users size={40} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>No CRM Leads Found</h2>
            <p style={{ maxWidth: '450px', margin: '0 auto' }}>
              Your database is currently empty. Upload a CSV file of your sales prospects, match the columns, and we'll import them with complete validation.
            </p>
          </div>
          <button id="btn-empty-import" className="btn btn-primary" onClick={onNavigateToImport}>
            <FolderOpen size={18} />
            Start CSV Import Wizard
          </button>
        </div>
      ) : (
        /* Full Dashboard Mode */
        <>
          {/* Analytics Stats Grid */}
          <div className="analytics-grid">
            {/* Total Leads */}
            <div className="glass-card stats-card">
              <div className="stats-icon-container" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#8b5cf6', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                <Users size={24} />
              </div>
              <div className="stats-info">
                <span className="stats-label">Total Leads</span>
                <span className="stats-value">{totalLeads}</span>
              </div>
            </div>

            {/* Pipeline Value */}
            <div className="glass-card stats-card">
              <div className="stats-icon-container" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                <DollarSign size={24} />
              </div>
              <div className="stats-info">
                <span className="stats-label">Pipeline Value</span>
                <span className="stats-value">
                  ${pipelineValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>

            {/* Validation Rate */}
            <div className="glass-card stats-card">
              <div className="stats-icon-container" style={{ 
                background: validationRate > 80 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)', 
                color: validationRate > 80 ? '#10b981' : '#f59e0b',
                border: validationRate > 80 ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(245, 158, 11, 0.2)'
              }}>
                {validationRate > 80 ? <CheckCircle size={24} /> : <ShieldAlert size={24} />}
              </div>
              <div className="stats-info">
                <span className="stats-label">Data Accuracy</span>
                <span className="stats-value">{validationRate}%</span>
              </div>
            </div>

            {/* Top Source */}
            <div className="glass-card stats-card">
              <div className="stats-icon-container" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', border: '1px solid rgba(6, 182, 212, 0.2)' }}>
                <TrendingUp size={24} />
              </div>
              <div className="stats-info">
                <span className="stats-label">Top Channel</span>
                <span className="stats-value" style={{ fontSize: '1.25rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>
                  {topSource}
                </span>
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="charts-container">
            {/* Status donut */}
            <div className="glass-card chart-card">
              <div className="chart-header">
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Lead Status Stages</h3>
                <BarChart2 size={18} style={{ color: 'var(--text-muted)' }} />
              </div>
              <div className="chart-content" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                {renderStatusDonut()}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#3b82f6' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>New: <strong>{statusCounts['New']}</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#f59e0b' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>Contacted: <strong>{statusCounts['Contacted']}</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#10b981' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>Qualified: <strong>{statusCounts['Qualified']}</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ef4444' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>Lost: <strong>{statusCounts['Lost']}</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* Source bar chart */}
            <div className="glass-card chart-card">
              <div className="chart-header">
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Top Traffic Channels</h3>
                <MapPin size={18} style={{ color: 'var(--text-muted)' }} />
              </div>
              <div className="chart-content" style={{ alignItems: 'flex-start', paddingTop: '1rem' }}>
                {renderSourceBarChart()}
              </div>
            </div>
          </div>

          {/* Recent Leads Grid */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Recently Imported Contacts</h3>
              <span className="badge badge-info" style={{ textTransform: 'none' }}>
                Showing last {Math.min(totalLeads, 6)} records
              </span>
            </div>
            <div className="table-container" style={{ margin: 0 }}>
              <table className="review-table">
                <thead>
                  <tr>
                    <th>Lead Name</th>
                    <th>Email</th>
                    <th>Company</th>
                    <th>Job Title</th>
                    <th>Location</th>
                    <th>Est. Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(-6).reverse().map((lead) => {
                    const statusColors: Record<string, string> = {
                      New: 'badge-info',
                      Contacted: 'badge-warning',
                      Qualified: 'badge-success',
                      Lost: 'badge-danger'
                    };

                    return (
                      <tr key={lead.id}>
                        <td style={{ fontWeight: '600' }}>{lead.name}</td>
                        <td>{lead.email}</td>
                        <td>{lead.company || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                        <td>{lead.jobTitle || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                        <td>{lead.location || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                        <td style={{ fontWeight: '500' }}>
                          {lead.revenue ? `$${parseFloat(lead.revenue).toLocaleString()}` : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                        </td>
                        <td>
                          <span className={`badge ${statusColors[lead.status] || 'badge-info'}`}>
                            {lead.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
