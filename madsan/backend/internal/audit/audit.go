package audit
import ("context"; "encoding/json"; "github.com/google/uuid"; "github.com/jackc/pgx/v5/pgxpool")
type Entry struct { TenantID, UserID, EntityID *uuid.UUID; Action, EntityType, RequestMethod, RequestPath, IPAddress string; Metadata map[string]any }
type Writer struct{ pool *pgxpool.Pool }
func NewWriter(pool *pgxpool.Pool) *Writer { return &Writer{pool: pool} }
func (w *Writer) Write(ctx context.Context, e Entry) error {
  if w==nil||w.pool==nil||e.Action=="" { return nil }
  meta:=e.Metadata; if meta==nil { meta=map[string]any{} }
  b,_:=json.Marshal(meta)
  _,err:=w.pool.Exec(ctx,`INSERT INTO audit_log (tenant_id,user_id,action,entity_type,entity_id,request_method,request_path,ip_address,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, e.TenantID,e.UserID,e.Action,nz(e.EntityType),e.EntityID,nz(e.RequestMethod),nz(e.RequestPath),nz(e.IPAddress),b)
  return err
}
func nz(s string)*string{ if s=="" {return nil}; return &s }
