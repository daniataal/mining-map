package notify
import ("context"; "fmt"; "strings")
func DealWatchAlert(ctx context.Context, sender Sender, userEmail, dealID string, changeTypes []string) error {
	if sender == nil || userEmail == "" || dealID == "" || len(changeTypes) == 0 { return nil }
	return sender.Send(ctx, Message{To: userEmail, Subject: fmt.Sprintf("MadSan deal watch — %s", dealID[:8]), Body: strings.Join(changeTypes, ", "), Template: "deal_watch_alert_v0"})
}
