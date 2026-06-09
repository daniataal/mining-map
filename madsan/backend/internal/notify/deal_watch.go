package notify
import ("context"; "fmt"; "strings")
func DealWatchAlert(ctx context.Context, sender Sender, userEmail, dealID string, changeTypes []string) error {
	if sender == nil || userEmail == "" || dealID == "" || len(changeTypes) == 0 { return nil }
	subj := dealID
	if len(subj) > 8 { subj = subj[:8] }
	return sender.Send(ctx, Message{To:userEmail, Subject:fmt.Sprintf("MadSan deal watch — %s", subj), Body:strings.Join(changeTypes, ", "), Template:"deal_watch_alert_v0", Tags:map[string]string{"deal_id":dealID}})
}
