package api
import ("net"; "net/http"; "strings"; "github.com/go-chi/chi/v5"; "github.com/google/uuid"; "github.com/madsan/intelligence/internal/audit")
type statusRecorder struct{ http.ResponseWriter; status int }
func (r *statusRecorder) WriteHeader(c int){ r.status=c; r.ResponseWriter.WriteHeader(c) }
func (s *Server) withAudit(action, entityType string) func(http.Handler) http.Handler {
  return func(next http.Handler) http.Handler { return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    rec:=&statusRecorder{ResponseWriter:w,status:200}; next.ServeHTTP(rec,r)
    if rec.status>=400 || s.auditor==nil { return }
    e:=audit.Entry{Action:action,EntityType:entityType,RequestMethod:r.Method,RequestPath:r.URL.Path,IPAddress:clientIP(r)}
    if claims,ok:=authClaims(r); ok {
      if uid,err:=uuid.Parse(claims.UserID); err==nil { e.UserID=&uid }
      if tid,err:=uuid.Parse(claims.TenantID); err==nil { e.TenantID=&tid }
    }
    if id:=chi.URLParam(r,"id"); id!="" { if eid,err:=uuid.Parse(id); err==nil { e.EntityID=&eid } }
    _=s.auditor.Write(r.Context(),e)
  }) }
}
func clientIP(r *http.Request) string {
  if x:=r.Header.Get("X-Forwarded-For"); x!="" { return strings.TrimSpace(strings.Split(x,",")[0]) }
  host,_,err:=net.SplitHostPort(r.RemoteAddr); if err!=nil { return r.RemoteAddr }; return host
}
