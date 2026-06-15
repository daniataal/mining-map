package notify
import ("context"; "github.com/rs/zerolog")
type Message struct { To, Subject, Body, Template string; Tags map[string]string }
type Sender interface { Send(ctx context.Context, msg Message) error }
type LogSender struct{ log zerolog.Logger }
func NewLogSender(log zerolog.Logger) *LogSender { return &LogSender{log: log} }
func (s *LogSender) Send(ctx context.Context, msg Message) error {
	if s == nil { return nil }
	s.log.Info().Str("channel","email").Str("to",msg.To).Str("subject",msg.Subject).Msg("notify scaffold")
	return nil
}
