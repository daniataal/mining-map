"use client";

type GraphNode = {
  id: string;
  entity_type: string;
  name: string;
  role?: string;
  asset_type?: string;
  mmsi?: string;
  confidence_score?: number;
};

type GraphEdge = {
  from: string;
  to: string;
  type: string;
  confidence_score?: number;
  detail?: string;
};

type Graph = {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  summary?: { node_count?: number; edge_count?: number };
};

type Props = {
  graph: Graph | null;
  watchActive?: boolean;
};

function nodeLabel(n: GraphNode) {
  const parts = [n.entity_type];
  if (n.role) parts.push(n.role);
  if (n.asset_type) parts.push(n.asset_type);
  return parts.join(" · ");
}

export default function DealGraphPanel({ graph, watchActive }: Props) {
  if (!graph?.nodes?.length) {
    return (
      <div style={{ marginTop: 12 }}>
        <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
          No relationship graph — add seller registry match or claimed vessel MMSI to populate links.
        </p>
        {watchActive && (
          <p style={{ fontSize: 11, color: "var(--accent)", margin: "8px 0 0" }}>
            Watching — pack entities will pin on the terminal map when map highlight ships.
          </p>
        )}
      </div>
    );
  }

  const nameByID = Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]));

  return (
    <div className="deal-graph" style={{ marginTop: 16 }}>
      <strong style={{ fontSize: 13 }}>Relationship graph</strong>
      <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 10px" }}>
        {graph.summary?.node_count ?? graph.nodes.length} entities · {graph.summary?.edge_count ?? graph.edges?.length ?? 0} links
        <span style={{ display: "block", marginTop: 4 }}>Inferred from registry + AIS — not cargo confirmation</span>
        {watchActive && (
          <span style={{ display: "block", marginTop: 6, color: "var(--accent)" }}>
            Watching — pack entities will pin on the terminal map when map highlight ships.
          </span>
        )}
      </p>
      <ul className="rel-list">
        {graph.nodes.map((n) => (
          <li key={n.id}>
            <div className="rel-link" style={{ cursor: "default" }}>
              <span className="rel-type">{nodeLabel(n)}</span>
              <span className="rel-name">{n.name}</span>
              {n.mmsi && <span className="rel-meta">MMSI {n.mmsi}</span>}
            </div>
          </li>
        ))}
      </ul>
      {graph.edges && graph.edges.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 12 }}>Links</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12, color: "var(--muted)" }}>
            {graph.edges.map((e, i) => (
              <li key={`${e.from}-${e.to}-${i}`}>
                <span style={{ color: "var(--text)" }}>{nameByID[e.from] ?? e.from.slice(0, 8)}</span>
                {" → "}
                <span style={{ color: "var(--text)" }}>{nameByID[e.to] ?? e.to.slice(0, 8)}</span>
                <span> ({e.type.replace(/_/g, " ")})</span>
                {e.detail && <span> — {e.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
