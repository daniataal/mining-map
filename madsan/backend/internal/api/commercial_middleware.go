package api
import ("net/http"; "github.com/madsan/intelligence/internal/compliance")
const headerSourceKeys = "X-Madsan-Source-Keys"
func (s *Server) requireCommercialSources(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    keys := sourceKeysFromRequest(r)
    if len(keys)==0 || s.ledger==nil { next.ServeHTTP(w,r); return }
    blocked, err := s.ledger.BlockingKeys(r.Context(), keys)
    if err != nil { http.Error(w,"source license check failed",500); return }
    if len(blocked)>0 { http.Error(w, compliance.CommercialUseError(blocked), 403); return }
    next.ServeHTTP(w,r)
  })
}
func sourceKeysFromRequest(r *http.Request) []string {
  if h:=r.Header.Get(headerSourceKeys); h!="" { return compliance.ParseSourceKeys(h) }
  return compliance.ParseSourceKeys(r.URL.Query().Get("source_keys"))
}
