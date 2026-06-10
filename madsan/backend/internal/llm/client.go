package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	tierAIAssisted = "ai_assisted"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Client struct {
	groqKey       string
	openRouterKey string
	http          *http.Client
}

func NewFromEnv() *Client {
	return &Client{
		groqKey:       envSecret("GROQ_API_KEY", "GROQ_AI_API_KEY"),
		openRouterKey: envSecret("OPENROUTER_API_KEY", "OPENROUTER_AI_API_KEY"),
		http:          &http.Client{Timeout: 45 * time.Second},
	}
}

func envSecret(names ...string) string {
	for _, n := range names {
		if v := strings.TrimSpace(os.Getenv(n)); v != "" && !strings.Contains(v, "{{") {
			return v
		}
	}
	return ""
}

func (c *Client) Available() bool {
	return c != nil && (c.groqKey != "" || c.openRouterKey != "")
}

// Complete runs a grounded chat completion. Returns tier ai_assisted on success.
func (c *Client) Complete(ctx context.Context, systemPrompt, userPrompt string) (text string, tier string, err error) {
	if c == nil || !c.Available() {
		return "", tierAIAssisted, fmt.Errorf("no LLM API key configured (set GROQ_API_KEY or OPENROUTER_API_KEY)")
	}
	msgs := []Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userPrompt},
	}
	if c.groqKey != "" {
		out, err := c.callOpenAICompat(ctx, "https://api.groq.com/openai/v1/chat/completions", c.groqKey, "llama-3.3-70b-versatile", msgs)
		if err == nil {
			return out, tierAIAssisted, nil
		}
	}
	if c.openRouterKey != "" {
		out, err := c.callOpenAICompat(ctx, "https://openrouter.ai/api/v1/chat/completions", c.openRouterKey, "openai/gpt-4o-mini", msgs)
		if err == nil {
			return out, tierAIAssisted, nil
		}
		return "", tierAIAssisted, err
	}
	return "", tierAIAssisted, fmt.Errorf("LLM request failed")
}

func (c *Client) callOpenAICompat(ctx context.Context, endpoint, apiKey, model string, messages []Message) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":       model,
		"messages":    messages,
		"temperature": 0.2,
		"max_tokens":  2048,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	if strings.Contains(endpoint, "openrouter.ai") {
		req.Header.Set("HTTP-Referer", "https://madsan.intelligence")
		req.Header.Set("X-Title", "MadSan DD Copilot")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("LLM HTTP %d: %s", resp.StatusCode, truncate(string(raw), 240))
	}
	var payload struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", err
	}
	if len(payload.Choices) == 0 || strings.TrimSpace(payload.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("empty LLM response")
	}
	return strings.TrimSpace(payload.Choices[0].Message.Content), nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
