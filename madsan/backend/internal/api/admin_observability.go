package api
import ("net/http"; "time")
func (s *Server) adminHealthObservability(w http.ResponseWriter, r *http.Request) {
  ctx:=r.Context(); now:=time.Now().UTC(); poolStats:=map[string]any{}
  if s.pool!=nil { st:=s.pool.Stat(); poolStats=map[string]any{"total_conns":st.TotalConns(),"idle_conns":st.IdleConns(),"acquired_conns":st.AcquiredConns(),"max_conns":st.MaxConns()} }
  queue:=map[string]any{"available":false}
  if s.ingest!=nil { if st,err:=s.ingest.JobStats(ctx); err==nil { queue=map[string]any{"available":true,"pending":st.Pending,"running":st.Running,"completed":st.Completed,"failed":st.Failed,"depth":st.Pending+st.Running} } }
  matviews:=[]map[string]any{}
  if s.pool!=nil {
    rows,err:=s.pool.Query(ctx,`SELECT c.relname,s.n_live_tup,GREATEST(s.last_vacuum,s.last_autovacuum,s.last_analyze,s.last_autoanalyze) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid WHERE c.relkind='m' AND n.nspname='public' ORDER BY c.relname`)
    if err==nil { defer rows.Close(); for rows.Next() { var name string; var est int64; var touch *time.Time; if rows.Scan(&name,&est,&touch)==nil { item:=map[string]any{"name":name,"row_estimate":est}; if touch!=nil&&!touch.IsZero(){ item["last_touch_at"]=touch.UTC().Format(time.RFC3339); item["age_sec"]=int(now.Sub(touch.UTC()).Seconds()) }; matviews=append(matviews,item) } } }
  }
  writeJSON(w,map[string]any{"checked_at":now.Format(time.RFC3339),"pool":poolStats,"job_queue":queue,"matviews":matviews})
}
