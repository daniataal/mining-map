import { useState, useRef, useEffect } from 'react';

const MultiSelect = ({ options, selected, onChange, placeholder, searchable = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleOption = (option) => {
        if (selected.includes(option)) {
            onChange(selected.filter(item => item !== option));
        } else {
            onChange([...selected, option]);
        }
    };

    const clearAll = () => {
        onChange([]);
    };

    const selectAll = () => {
        onChange(options);
    };

    const filteredOptions = searchable && searchTerm
        ? options.filter(opt => opt.toLowerCase().includes(searchTerm.toLowerCase()))
        : options;

    const displayText = selected.length === 0
        ? `All ${placeholder}`
        : selected.length === 1
            ? selected[0]
            : `${selected.length} selected`;

    return (
        <div ref={dropdownRef} style={{ position: 'relative', width: '100%' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '8px 12px',
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: selected.length === 0 ? '#8b949e' : '#e6edf3',
                    fontSize: '0.9em'
                }}
            >
                <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}>
                    {displayText}
                </span>
                <span style={{ marginLeft: '8px', fontSize: '0.7em' }}>▼</span>
            </div>

            {isOpen && (
                <div
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: '4px',
                        background: '#161b22',
                        border: '1px solid #30363d',
                        borderRadius: '6px',
                        maxHeight: '250px',
                        overflowY: 'auto',
                        zIndex: 1000,
                        boxShadow: '0 8px 16px rgba(0,0,0,0.4)'
                    }}
                >
                    {searchable && (
                        <div style={{ padding: '8px', borderBottom: '1px solid #30363d' }}>
                            <input
                                type="text"
                                placeholder={`Search ${placeholder}...`}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    width: '100%',
                                    padding: '6px 8px',
                                    background: '#0d1117',
                                    border: '1px solid #30363d',
                                    borderRadius: '4px',
                                    color: '#e6edf3',
                                    fontSize: '0.85em'
                                }}
                            />
                        </div>
                    )}

                    <div style={{ padding: '4px 8px', borderBottom: '1px solid #30363d', display: 'flex', gap: '8px' }}>
                        <button
                            onClick={(e) => { e.stopPropagation(); selectAll(); }}
                            style={{
                                flex: 1,
                                padding: '4px 8px',
                                background: 'transparent',
                                border: '1px solid #30363d',
                                borderRadius: '4px',
                                color: '#58a6ff',
                                fontSize: '0.75em',
                                cursor: 'pointer'
                            }}
                        >
                            Select All
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); clearAll(); }}
                            style={{
                                flex: 1,
                                padding: '4px 8px',
                                background: 'transparent',
                                border: '1px solid #30363d',
                                borderRadius: '4px',
                                color: '#f85149',
                                fontSize: '0.75em',
                                cursor: 'pointer'
                            }}
                        >
                            Clear All
                        </button>
                    </div>

                    {filteredOptions.map((option) => (
                        <div
                            key={option}
                            onClick={() => toggleOption(option)}
                            style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: selected.includes(option) ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                                color: '#e6edf3',
                                fontSize: '0.85em',
                                borderBottom: '1px solid #21262d'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = selected.includes(option) ? 'rgba(88, 166, 255, 0.15)' : 'rgba(255,255,255,0.05)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = selected.includes(option) ? 'rgba(88, 166, 255, 0.1)' : 'transparent'}
                        >
                            <div
                                style={{
                                    width: '16px',
                                    height: '16px',
                                    border: '2px solid #30363d',
                                    borderRadius: '3px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: selected.includes(option) ? '#58a6ff' : 'transparent',
                                    flexShrink: 0
                                }}
                            >
                                {selected.includes(option) && (
                                    <span style={{ color: '#0d1117', fontSize: '0.7em', fontWeight: 'bold' }}>✓</span>
                                )}
                            </div>
                            <span>{option}</span>
                        </div>
                    ))}

                    {filteredOptions.length === 0 && (
                        <div style={{ padding: '12px', textAlign: 'center', color: '#8b949e', fontSize: '0.85em' }}>
                            No results found
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default MultiSelect;
