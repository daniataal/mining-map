import { useState, useRef, useEffect } from 'react';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { LucideChevronDown, LucideSearch, LucideCheck, LucideX } from 'lucide-react';
import { Badge } from './ui/badge';
import { motion, AnimatePresence } from 'framer-motion';

interface MultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder: string;
  searchable?: boolean;
}

export default function MultiSelect({ options, selected, onChange, placeholder, searchable = false }: MultiSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebouncedValue(searchTerm);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleOption = (option: string) => {
        if (selected.includes(option)) {
            onChange(selected.filter(item => item !== option));
        } else {
            onChange([...selected, option]);
        }
    };

    const filteredOptions = searchable && debouncedSearchTerm
        ? options.filter(opt => opt.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
        : options;

    return (
        <div ref={dropdownRef} className="relative w-full">
            <div
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center justify-between px-3 py-2 bg-slate-950 border rounded-lg cursor-pointer transition-all h-10 ${isOpen ? 'border-amber-500 ring-1 ring-amber-500/20' : 'border-slate-800 hover:border-slate-700'}`}
            >
                <div className="flex items-center gap-1 overflow-hidden">
                    {selected.length === 0 ? (
                        <span className="text-sm text-slate-500 truncate">{placeholder}</span>
                    ) : (
                        <div className="flex gap-1 overflow-hidden">
                            <Badge className="bg-amber-500/10 text-amber-500 border-none text-[10px] h-5 px-1.5 font-bold">
                                {selected.length} {selected.length === 1 ? 'Selected' : 'Selected'}
                            </Badge>
                        </div>
                    )}
                </div>
                <LucideChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-0 right-0 z-[1000] mt-2 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl overflow-hidden"
                    >
                        {searchable && (
                            <div className="p-2 border-b border-slate-800 relative">
                                <LucideSearch className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                                <Input
                                    autoFocus
                                    placeholder={`Search...`}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="h-8 pl-8 text-xs bg-slate-950 border-slate-800"
                                />
                            </div>
                        )}

                        <div className="p-1 border-b border-slate-800 flex gap-1">
                            <Button variant="ghost" className="flex-1 h-7 text-[10px] font-bold text-slate-400" onClick={() => onChange([...new Set([...selected, ...filteredOptions])])}>Select All</Button>
                            <Button variant="ghost" className="flex-1 h-7 text-[10px] font-bold text-slate-400" onClick={() => onChange([])}>Clear</Button>
                        </div>

                        <div className="max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                            {filteredOptions.map((option) => {
                                const isSelected = selected.includes(option);
                                return (
                                    <div
                                        key={option}
                                        onClick={() => toggleOption(option)}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-xs transition-colors ${isSelected ? 'bg-amber-500/10 text-amber-500' : 'text-slate-300 hover:bg-slate-800'}`}
                                    >
                                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-amber-500 border-amber-500' : 'border-slate-700'}`}>
                                            {isSelected && <LucideCheck className="w-2.5 h-2.5 text-slate-950 stroke-[3]" />}
                                        </div>
                                        <span className="flex-1 truncate">{option}</span>
                                    </div>
                                );
                            })}
                            {filteredOptions.length === 0 && (
                                <div className="py-8 text-center text-slate-600 text-[10px] uppercase font-bold tracking-widest italic">
                                    No results
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
