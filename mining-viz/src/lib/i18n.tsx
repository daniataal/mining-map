import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'he';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (he: string, en: string) => string;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('app_lang');
    return (saved as Language) || 'en';
  });

  useEffect(() => {
    localStorage.setItem('app_lang', language);
    document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const t = (he: string, en: string) => {
    return language === 'he' ? he : en;
  };

  const isRtl = language === 'he';

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, isRtl }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};

// Global shorthand for usage in components
export const t = (he: string, en: string) => {
  // This is a placeholder for when we can't use the hook directly
  // In practice, we should use the hook or a global state
  return (localStorage.getItem('app_lang') === 'he' ? he : en);
};
