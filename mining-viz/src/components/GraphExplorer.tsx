import { useEffect, useState, useRef } from 'react';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Loader2 } from 'lucide-react';

interface GraphNode {
  id: string;
  type: string;
  label: string;
  metadata?: any;
}

interface GraphEdge {
  source_id: string;
  target_id: string;
  label: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphExplorerProps {
  nodeId: string;
  nodeType: string;
  onNodeClick?: (node: GraphNode) => void;
}

export function GraphExplorer({ nodeId, nodeType, onNodeClick }: GraphExplorerProps) {
  const [data, setData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const graphRef = useRef<ForceGraphMethods>();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      setDimensions({
        width: containerRef.current.clientWidth,
        height: 600, // Fixed height or could be dynamic
      });
    }

    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: 600,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const fetchGraph = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/oil-live/graph/explore?node_id=${nodeId}&node_type=${nodeType}`);
        if (!res.ok) throw new Error('Failed to fetch graph data');
        const json: GraphData = await res.json();
        
        // Transform to react-force-graph format
        const formattedData = {
          nodes: json.nodes.map(n => ({
            ...n,
            val: n.id === nodeId ? 3 : 1.5, // Make root node larger
            color: n.type === 'asset' ? '#3b82f6' : '#10b981', // Blue for assets, Green for orgs
          })),
          links: json.edges.map(e => ({
            source: e.source_id,
            target: e.target_id,
            name: e.label,
          }))
        };
        setData(formattedData);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchGraph();
  }, [nodeId, nodeType]);

  // Handle zoom-to-fit once data is loaded
  useEffect(() => {
    if (!loading && data.nodes.length > 0 && graphRef.current) {
      setTimeout(() => {
        graphRef.current?.zoomToFit(400, 50);
      }, 500);
    }
  }, [loading, data]);

  return (
    <Card className="w-full bg-slate-900 border-slate-800 shadow-xl overflow-hidden">
      <CardHeader className="bg-slate-950 border-b border-slate-800 flex flex-row items-center justify-between py-3">
        <CardTitle className="text-slate-100 flex items-center gap-2">
          Network Graph
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </CardTitle>
        <div className="flex gap-2">
          <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20">Assets</Badge>
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Organizations</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0 m-0 relative" ref={containerRef}>
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-red-400 p-4 text-center z-10 bg-slate-900/80">
            {error}
          </div>
        )}
        <div className="w-full" style={{ height: dimensions.height }}>
          {!loading && data.nodes.length > 0 && (
            <ForceGraph2D
              ref={graphRef}
              width={dimensions.width}
              height={dimensions.height}
              graphData={data}
              nodeLabel="label"
              nodeColor="color"
              nodeRelSize={6}
              linkColor={() => 'rgba(148, 163, 184, 0.3)'} // slate-400 with opacity
              linkWidth={1.5}
              linkDirectionalArrowLength={3.5}
              linkDirectionalArrowRelPos={1}
              onNodeClick={(node) => {
                if (onNodeClick) onNodeClick(node as GraphNode);
              }}
              // Draw text on links
              linkCanvasObjectMode={() => 'after'}
              linkCanvasObject={(link: any, ctx, globalScale) => {
                const MAX_FONT_SIZE = 4;
                const LABEL_NODE_MARGIN = 12;
                const start = link.source;
                const end = link.target;
                if (typeof start !== 'object' || typeof end !== 'object') return;
                
                const textPos = Object.assign(...['x', 'y'].map(c => ({
                  [c]: start[c] + (end[c] - start[c]) / 2
                })));
                
                const relLink = { x: end.x - start.x, y: end.y - start.y };
                const maxTextLength = Math.sqrt(Math.pow(relLink.x, 2) + Math.pow(relLink.y, 2)) - LABEL_NODE_MARGIN * 2;
                
                let textAngle = Math.atan2(relLink.y, relLink.x);
                if (textAngle > Math.PI / 2) textAngle = -(Math.PI - textAngle);
                if (textAngle < -Math.PI / 2) textAngle = -(Math.PI + textAngle);
                
                const label = link.name;
                const fontSize = Math.min(MAX_FONT_SIZE, maxTextLength / (label.length || 1));
                
                ctx.font = `${fontSize}px Inter, sans-serif`;
                const textWidth = ctx.measureText(label).width;
                const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);
                
                ctx.save();
                ctx.translate(textPos.x, textPos.y);
                ctx.rotate(textAngle);
                
                ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'; // slate-900
                ctx.fillRect(-bckgDimensions[0] / 2, -bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
                
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'rgba(148, 163, 184, 1)'; // slate-400
                ctx.fillText(label, 0, 0);
                ctx.restore();
              }}
            />
          )}
          {!loading && data.nodes.length === 0 && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500">
              No connections found.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
