import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Card } from './ui/card';

interface PanelErrorBoundaryProps {
  children: ReactNode;
  title?: string;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

export default class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[PanelErrorBoundary]', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <Card className="bg-amber-500/5 border-amber-500/10 rounded-3xl p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">
            {this.props.title ?? 'Section unavailable'}
          </p>
          <p className="text-[10px] text-slate-400">
            This panel section failed to render. Other vessel details remain available.
          </p>
        </Card>
      );
    }
    return this.props.children;
  }
}
