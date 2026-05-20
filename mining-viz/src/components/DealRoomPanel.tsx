import { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import type { AgentJobResponse, DealRoom, MiningLicense } from '../types';
import {
  exportDealRoom,
  getAgentJob,
  runDealRoomAgents,
  updateDealRoom,
} from '../lib/api';
import { DEAL_ROOM_ARCHIVED_STATUS, isDealRoomArchived } from '../lib/dealRoomIndex';

const DEFAULT_AGENTS = ['dd', 'operator', 'contact', 'procurement', 'route'];

function formatJobLabel(agentType: string) {
  return agentType
    .replace(/_summary$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusTone(status: string) {
  if (status === 'completed') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed') return 'bg-red-500/15 text-red-700 dark:text-red-300';
  if (status === 'running') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return 'bg-slate-500/15 text-slate-600 dark:text-slate-300';
}

function summarizeOutput(output: unknown): string {
  if (!output || typeof output !== 'object') return 'No output yet.';
  const record = output as Record<string, unknown>;
  const direct = record.summary;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (direct && typeof direct === 'object') {
    return JSON.stringify(direct);
  }
  if (typeof record.risk_level === 'string') return `Route risk: ${record.risk_level}`;
  if (typeof record.recommendation === 'string') return `Recommendation: ${record.recommendation}`;
  if (Array.isArray(record.contacts)) return `${record.contacts.length} contact candidate(s) found.`;
  return JSON.stringify(record).slice(0, 500);
}

function mergeJobs(
  current: AgentJobResponse<Record<string, unknown>>[],
  next: AgentJobResponse<Record<string, unknown>>[],
) {
  const byId = new Map(current.map((job) => [job.job_id, job]));
  next.forEach((job) => byId.set(job.job_id, { ...byId.get(job.job_id), ...job }));
  return Array.from(byId.values());
}

interface DealRoomPanelProps {
  dealRoom: DealRoom;
  entity?: MiningLicense | null;
  onDealRoomChange: (dealRoom: DealRoom) => void;
}

export default function DealRoomPanel({ dealRoom, entity, onDealRoomChange }: DealRoomPanelProps) {
  const [jobs, setJobs] = useState<AgentJobResponse<Record<string, unknown>>[]>(dealRoom.jobs ?? []);
  const [notes, setNotes] = useState(dealRoom.notes ?? '');
  const [isRunning, setIsRunning] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [exportText, setExportText] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setJobs(dealRoom.jobs ?? []);
    setNotes(dealRoom.notes ?? '');
  }, [dealRoom.id, dealRoom.jobs, dealRoom.notes]);

  const hasRoute = Boolean(dealRoom.routeSnapshot);
  const runnableAgents = useMemo(
    () => (hasRoute ? DEFAULT_AGENTS : DEFAULT_AGENTS.filter((agent) => agent !== 'route')),
    [hasRoute],
  );
  const activeJobs = jobs.filter((job) => ['queued', 'running'].includes(job.status));

  useEffect(() => {
    if (!activeJobs.length) return;
    const timer = window.setInterval(() => {
      Promise.all(
        activeJobs.map((job) =>
          getAgentJob<Record<string, unknown>>(job.job_id).catch(() => job),
        ),
      ).then((updatedJobs) => {
        setJobs((prev) => mergeJobs(prev, updatedJobs));
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeJobs]);

  async function handleRunAgents(forceRefresh = false) {
    setIsRunning(true);
    setMessage(null);
    try {
      const response = await runDealRoomAgents(dealRoom.id, {
        agents: runnableAgents,
        forceRefresh,
      });
      onDealRoomChange(response.dealRoom);
      setJobs((prev) => mergeJobs(prev, response.jobs));
      const skipped = response.skipped?.map((item) => item.reason).join(' ');
      setMessage(skipped || 'Agents queued. Results will appear as jobs finish.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not queue deal room agents.');
    } finally {
      setIsRunning(false);
    }
  }

  async function handleArchiveToggle() {
    const reactivate = isDealRoomArchived(dealRoom);
    setIsArchiving(true);
    setMessage(null);
    try {
      const updated = await updateDealRoom(dealRoom.id, {
        status: reactivate ? 'open' : DEAL_ROOM_ARCHIVED_STATUS,
      });
      onDealRoomChange(updated);
      setMessage(reactivate ? 'Deal room reactivated.' : 'Deal room archived.');
    } catch {
      setMessage(reactivate ? 'Could not reactivate deal room.' : 'Could not archive deal room.');
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleSaveNotes() {
    setIsSavingNotes(true);
    setMessage(null);
    try {
      const updated = await updateDealRoom(dealRoom.id, { notes });
      onDealRoomChange(updated);
      setMessage('Notes saved.');
    } catch {
      setMessage('Could not save notes.');
    } finally {
      setIsSavingNotes(false);
    }
  }

  async function handleExport() {
    setMessage(null);
    try {
      const exported = await exportDealRoom(dealRoom.id, 'markdown');
      const markdown = typeof exported === 'string' ? exported : exported.markdown ?? JSON.stringify(exported, null, 2);
      setExportText(markdown);
      try {
        await navigator.clipboard.writeText(markdown);
        setMessage('Decision package copied to clipboard.');
      } catch {
        setMessage('Decision package generated below.');
      }
    } catch {
      setMessage('Could not export decision package.');
    }
  }

  function downloadExport() {
    if (!exportText) return;
    const blob = new Blob([exportText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deal-room-${dealRoom.id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl space-y-5">
      <Card className="rounded-3xl border border-black/5 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
              Investigation / Deal Room
            </p>
            <h3 className="mt-1 text-xl font-black uppercase text-slate-900 dark:text-white">
              {dealRoom.title}
            </h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {entity?.company || String(dealRoom.entity?.company || dealRoom.entityId)} · {entity?.country || String(dealRoom.entity?.country || 'Unknown country')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-none bg-slate-500/10 text-[9px] font-black uppercase text-slate-600 dark:text-slate-300">
              {isDealRoomArchived(dealRoom) ? 'archived' : dealRoom.status}
            </Badge>
            <Badge className={`border-none text-[9px] font-black uppercase ${hasRoute ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>
              {hasRoute ? 'Route attached' : 'No route'}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={isArchiving}
              onClick={() => void handleArchiveToggle()}
              className="rounded-xl text-[9px] font-black uppercase tracking-widest"
            >
              {isDealRoomArchived(dealRoom) ? (
                <>
                  <ArchiveRestore className="w-3 h-3 mr-1" />
                  Reactivate
                </>
              ) : (
                <>
                  <Archive className="w-3 h-3 mr-1" />
                  Archive
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Button
            onClick={() => handleRunAgents(false)}
            disabled={isRunning}
            className="h-10 rounded-xl bg-amber-500 text-[10px] font-black uppercase tracking-widest text-slate-950 hover:bg-amber-600"
          >
            {isRunning ? 'Queueing...' : 'Run agents'}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleRunAgents(true)}
            disabled={isRunning}
            className="h-10 rounded-xl text-[10px] font-black uppercase tracking-widest"
          >
            Force refresh
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            className="h-10 rounded-xl text-[10px] font-black uppercase tracking-widest"
          >
            Export package
          </Button>
        </div>
        {message && <p className="mt-3 text-[11px] font-bold text-slate-500">{message}</p>}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="rounded-3xl border border-black/5 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]">
          <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Agent queue</p>
          {jobs.length === 0 ? (
            <p className="text-xs font-semibold text-slate-500">No agents queued yet.</p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div key={job.job_id} className="rounded-2xl border border-black/5 bg-white/60 p-3 dark:border-white/10 dark:bg-slate-950/40">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-black uppercase text-slate-900 dark:text-white">
                      {formatJobLabel(job.agent_type)}
                    </p>
                    <Badge className={`border-none text-[9px] font-black uppercase ${statusTone(job.status)}`}>
                      {job.cached ? 'cached · ' : ''}{job.status}
                    </Badge>
                  </div>
                  {job.error ? (
                    <p className="mt-2 text-[10px] font-bold text-red-500">{job.error}</p>
                  ) : (
                    <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-slate-500">
                      {summarizeOutput(job.output)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="rounded-3xl border border-black/5 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Analyst notes</p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveNotes}
              disabled={isSavingNotes}
              className="rounded-xl text-[10px] font-black uppercase"
            >
              {isSavingNotes ? 'Saving...' : 'Save'}
            </Button>
          </div>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="h-40 w-full resize-none rounded-2xl border border-black/10 bg-white px-4 py-3 text-xs font-semibold text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-amber-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300"
            placeholder="Decision rationale, missing documents, next procurement or route checks..."
          />
          {hasRoute && (
            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3 text-[11px] font-semibold text-emerald-900 dark:text-emerald-100">
              Route snapshot is attached and will be included in the export.
            </div>
          )}
        </Card>
      </div>

      {exportText && (
        <Card className="rounded-3xl border border-black/5 bg-slate-950 p-5 text-emerald-200">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Decision package</p>
            <Button variant="outline" size="sm" onClick={downloadExport} className="rounded-xl text-[10px] font-black uppercase">
              Download
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed">{exportText}</pre>
        </Card>
      )}
    </div>
  );
}

