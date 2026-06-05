import { useI18n } from '../../lib/i18n';
import {
  companyLeadSourceLabel,
  miningLicenseFromCompanyLead,
  useCompanyResolve,
} from '../../lib/companyResolve';

interface CompanyLeadButtonProps {
  name: string;
  country?: string;
  source?: string;
  sourceLabel?: string;
  onOpenDossier?: (item: ReturnType<typeof miningLicenseFromCompanyLead>) => void;
  className?: string;
}

export default function CompanyLeadButton({
  name,
  country = '',
  source,
  sourceLabel,
  onOpenDossier,
  className = '',
}: CompanyLeadButtonProps) {
  const { t } = useI18n();
  const { data } = useCompanyResolve(name, country, Boolean(onOpenDossier));
  const tier = sourceLabel || companyLeadSourceLabel(source);
  const confidence = data?.match_confidence;

  if (!onOpenDossier) {
    return <span className={className}>{name}</span>;
  }

  return (
    <button
      type="button"
      className={`text-left font-medium text-sky-600 dark:text-sky-400 hover:underline ${className}`}
      onClick={() =>
        onOpenDossier(
          miningLicenseFromCompanyLead(
            data?.name || name,
            data?.country || country,
            source,
          ),
        )
      }
    >
      {name}
      <span className="ml-1 text-[9px] font-normal text-slate-500 not-italic">
        ({tier}
        {confidence && confidence !== 'none' ? ` · ${confidence}` : ''})
      </span>
    </button>
  );
}
