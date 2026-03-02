import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { getProvider } from '@/lib/ai-provider';
import { X, RefreshCw, Trash2, Search, CheckCircle2, AlertCircle, Clock, Loader2, Database, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

interface AdminDashboardProps {
    onClose: () => void;
    onRetry: () => void;
}

export function AdminDashboard({ onClose, onRetry }: AdminDashboardProps) {
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<string>('all');

    const [showConfirmWipe, setShowConfirmWipe] = useState(false);
    const [wipeInput, setWipeInput] = useState('');

    const stats = useLiveQuery(async () => {
        return {
            total: await db.photos.count(),
            new: await db.photos.where('status').equals('new').count(),
            processing: await db.photos.where('status').equals('processing').count(),
            done: await db.photos.where('status').equals('done').count(),
            queued: await db.photos.where('status').equals('queued').count(),
            analyzing: await db.photos.where('status').equals('analyzing').count(),
            scored: await db.photos.where('status').equals('scored').count(),
            error: await db.photos.where('status').equals('error').count(),
        };
    }) || { total: 0, new: 0, processing: 0, done: 0, queued: 0, analyzing: 0, scored: 0, error: 0 };

    const jobs = useLiveQuery(async () => {
        let result = await db.photos.reverse().sortBy('createdAt');
        if (filter !== 'all') {
            result = result.filter(p => p.status === filter);
        }
        if (search) {
            result = result.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.id.toLowerCase().includes(search.toLowerCase()));
        }
        return result;
    }, [search, filter]) || [];

    const handleClearAll = () => {
        setWipeInput('');
        setShowConfirmWipe(true);
    };

    const executeWipe = async () => {
        if (wipeInput === 'DELETE') {
            await db.photos.clear();
            await db.logs.clear();
            logger.warn('Administrative Data Wipe performed');
            toast.success("System reset complete.");
            onClose();
            // Force a page reload to clear out any in-memory FileHandles and React state locks
            window.location.reload();
        } else {
            toast.error("Deletion cancelled. Type 'DELETE' exactly.");
            setShowConfirmWipe(false);
        }
    };

    const handleResetPipeline = async () => {
        const stuck = await db.photos.where('status').equals('analyzing').toArray();
        await db.transaction('rw', db.photos, async () => {
            for (const p of stuck) {
                await db.photos.update(p.id, { status: 'queued', updatedAt: Date.now() });
            }
        });
        window.dispatchEvent(new CustomEvent('pipeline-wakeup'));
        logger.info(`Reset ${stuck.length} analyzing tasks back to queue`);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-[#0A0A0A] flex flex-col animate-in fade-in duration-300">
            {/* Header */}
            <div className="h-16 border-b border-[#262626] flex items-center justify-between px-6 bg-[#111111]">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center border border-blue-600/30">
                        <Database size={18} className="text-blue-500" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold">Admin Console</h2>
                        <p className="text-xs text-gray-500">Live Process Monitor & DB Management</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-[#262626] rounded-full transition-colors"
                >
                    <X size={20} className="text-gray-400" />
                </button>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-8">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                    <StatCard title="Total" value={stats.total} icon={<Database size={14} />} color="gray" />
                    <StatCard title="New" value={stats.new} icon={<Clock size={14} />} color="blue" />
                    <StatCard title="Local Process" value={stats.processing} icon={<Loader2 size={14} className="animate-spin" />} color="yellow" />
                    <StatCard title="Ready" value={stats.done} icon={<CheckCircle2 size={14} />} color="green" />
                    <StatCard title="Queued" value={stats.queued} icon={<Clock size={14} />} color="yellow" />
                    <StatCard title="AI Analyzing" value={stats.analyzing} icon={<RefreshCw size={14} className="animate-spin" />} color="blue" />
                    <StatCard title="Scored" value={stats.scored} icon={<CheckCircle2 size={14} />} color="purple" />
                    <StatCard title="Errors" value={stats.error} icon={<AlertCircle size={14} />} color="red" />
                </div>

                {/* Controls */}
                <div className="bg-[#111111] border border-[#262626] rounded-2xl p-6 flex flex-wrap gap-4 items-center justify-between">
                    <div className="flex items-center gap-4 flex-1 min-w-[300px]">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search jobs by name or ID..."
                                className="w-full bg-[#1A1A1A] border border-[#262626] rounded-xl pl-10 pr-4 py-2 text-sm focus:border-blue-500 transition-all outline-none"
                            />
                        </div>
                        <select
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            className="bg-[#1A1A1A] border border-[#262626] rounded-xl px-4 py-2 text-sm outline-none focus:border-blue-500"
                        >
                            <option value="all">All Statuses</option>
                            <option value="queued">Queued</option>
                            <option value="analyzing">Analyzing</option>
                            <option value="scored">Scored</option>
                            <option value="error">Error</option>
                        </select>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={async () => {
                                try {
                                    toast.loading("Testing Gemini Connection...");
                                    const result = await getProvider().testConnection();
                                    toast.dismiss();
                                    toast.success("Connection Successful!", { description: `Response: ${result}` });
                                } catch (e: unknown) {
                                    const errMsg = e instanceof Error ? e.message : String(e);
                                    toast.dismiss();
                                    toast.error("Connection Failed", { description: errMsg });
                                }
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-purple-600/10 text-purple-400 border border-purple-600/30 rounded-xl hover:bg-purple-600/20 transition-all text-sm font-medium"
                        >
                            <Wifi size={16} /> Test API
                        </button>
                        <button
                            onClick={handleResetPipeline}
                            className="flex items-center gap-2 px-4 py-2 bg-yellow-600/10 text-yellow-500 border border-yellow-600/30 rounded-xl hover:bg-yellow-600/20 transition-all text-sm font-medium"
                        >
                            <RefreshCw size={16} /> Force Reset Pipeline
                        </button>
                        <button
                            onClick={onRetry}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600/10 text-blue-400 border border-blue-600/30 rounded-xl hover:bg-blue-600/20 transition-all text-sm font-medium"
                        >
                            <AlertCircle size={16} /> Retry Errors
                        </button>
                        <button
                            onClick={handleClearAll}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600/10 text-red-500 border border-red-600/30 rounded-xl hover:bg-red-600/20 transition-all text-sm font-medium"
                        >
                            <Trash2 size={16} /> Wipe All Data
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="bg-[#111111] border border-[#262626] rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-[#1A1A1A] text-gray-400 font-medium">
                            <tr>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">ID / Filename</th>
                                <th className="px-6 py-4">Score</th>
                                <th className="px-6 py-4">Updated</th>
                                <th className="px-6 py-4 text-right">Reason / Error</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#262626]">
                            {jobs.map(job => (
                                <tr key={job.id} className="hover:bg-[#161616] transition-colors">
                                    <td className="px-6 py-4">
                                        <StatusBadge status={job.status} />
                                    </td>
                                    <td className="px-6 py-4 font-mono text-xs">{job.name}</td>
                                    <td className="px-6 py-4">
                                        {job.score ? <span className="font-bold text-blue-400">{job.score.toFixed(1)}</span> : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-gray-400 text-xs">
                                        {job.updatedAt ? new Date(job.updatedAt).toLocaleTimeString() : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-right max-w-xs truncate text-gray-500 italic text-xs">
                                        {job.reason || '-'}
                                    </td>
                                </tr>
                            ))}
                            {jobs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                        No jobs matching your filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Wipe Confirmation Modal */}
            {showConfirmWipe && (
                <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#161616] border border-red-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3 text-red-500 pb-2 border-b border-[#262626]">
                            <AlertCircle size={24} />
                            <h3 className="text-lg font-bold">DANGER ZONE</h3>
                        </div>
                        <p className="text-gray-300 text-sm leading-relaxed">
                            This will permanently delete <strong>ALL</strong> photos and logs from the local database. This action cannot be undone.
                        </p>
                        <div className="space-y-2 pt-2">
                            <label className="text-xs font-semibold text-gray-500 tracking-wider">TYPE "DELETE" TO CONFIRM</label>
                            <input
                                autoFocus
                                value={wipeInput}
                                onChange={e => setWipeInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') executeWipe();
                                    if (e.key === 'Escape') setShowConfirmWipe(false);
                                }}
                                className="w-full bg-[#0A0A0A] border border-[#333] focus:border-red-500 rounded-xl px-4 py-3 font-mono text-center tracking-widest outline-none transition-colors"
                                placeholder="DELETE"
                            />
                        </div>
                        <div className="flex gap-3 pt-4">
                            <button
                                onClick={() => setShowConfirmWipe(false)}
                                className="flex-1 px-4 py-2.5 bg-[#262626] hover:bg-[#333] rounded-xl text-sm font-semibold transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeWipe}
                                disabled={wipeInput !== 'DELETE'}
                                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:hover:bg-red-600 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                            >
                                <Trash2 size={16} /> Wipe DB
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface StatCardProps {
    title: string;
    value: number;
    icon: React.ReactNode;
    color: 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple';
}

function StatCard({ title, value, icon, color }: StatCardProps) {
    const colors: Record<string, string> = {
        gray: "text-gray-400 bg-gray-400/10 border-gray-400/20",
        blue: "text-blue-500 bg-blue-500/10 border-blue-500/20",
        green: "text-green-500 bg-green-500/10 border-green-500/20",
        yellow: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
        red: "text-red-500 bg-red-500/10 border-red-500/20",
        purple: "text-purple-500 bg-purple-500/10 border-purple-500/20",
    };
    return (
        <div className={cn("p-4 rounded-2xl border transition-all", colors[color])}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">{title}</span>
                {icon}
            </div>
            <div className="text-xl font-bold">{value}</div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        new: "bg-gray-500/10 text-gray-500 border-gray-500/20",
        processing: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
        done: "bg-green-500/10 text-green-500 border-green-500/20",
        queued: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        analyzing: "bg-blue-600/20 text-blue-500 border-blue-600/30 animate-pulse",
        scored: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        error: "bg-red-500/10 text-red-500 border-red-500/20",
    };

    return (
        <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-tight", styles[status])}>
            {status}
        </span>
    );
}
