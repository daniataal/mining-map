import { Skeleton } from './ui/skeleton';

export default function SkeletonLoader({ count = 3 }: { count?: number }) {
    return (
        <div className="p-4 space-y-4">
            {[...Array(count)].map((_, i) => (
                <div key={i} className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-3">
                    <Skeleton className="h-5 w-3/4 bg-slate-800" />
                    <Skeleton className="h-4 w-1/2 bg-slate-800" />
                    <div className="flex gap-2 pt-2">
                        <Skeleton className="h-6 w-16 bg-slate-800 rounded-full" />
                        <Skeleton className="h-6 w-20 bg-slate-800 rounded-full" />
                    </div>
                </div>
            ))}
        </div>
    );
}
