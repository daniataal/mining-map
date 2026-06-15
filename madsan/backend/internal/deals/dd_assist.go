package deals

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/madsan/intelligence/internal/llm"
	"github.com/madsan/intelligence/internal/supplyweb"
)

const ddAssistTier = "ai_assisted"

type DDAssistRequest struct {
	Focus string `json:"focus,omitempty"`
}

type DDAssistResponse struct {
	DealID               string   `json:"deal_id"`
	Tier                 string   `json:"tier"`
	Available            bool     `json:"llm_available"`
	Summary              string   `json:"summary,omitempty"`
	RiskNarrative        string   `json:"risk_narrative,omitempty"`
	UnansweredQuestions  []string `json:"unanswered_questions,omitempty"`
	DocumentRequests     []string `json:"document_requests,omitempty"`
	EvidenceCitations    []string `json:"evidence_citations,omitempty"`
	Limitations          []string `json:"limitations,omitempty"`
	Message              string   `json:"message,omitempty"`
}

func (s *Service) DDAssist(ctx context.Context, dealID string, req DDAssistRequest, llmClient *llm.Client) (DDAssistResponse, error) {
	resp := DDAssistResponse{
		DealID: dealID,
		Tier:   ddAssistTier,
		Limitations: []string{
			"AI-assisted output — does not override observed evidence or compliance screening",
			"Every claim must be verified against source documents before transaction decisions",
		},
	}
	if llmClient != nil {
		resp.Available = llmClient.Available()
	}
	if !resp.Available {
		resp.Message = "Configure GROQ_API_KEY or OPENROUTER_API_KEY to enable DD copilot"
		return resp, nil
	}

	pack, err := s.BuildPack(ctx, dealID)
	if err != nil {
		return resp, err
	}

	grounding := buildDDGrounding(pack)
	systemPrompt := `You are a commodity due-diligence assistant for MadSan Intelligence.
Use ONLY the evidence, dd_checks, sanctions results, and supply-web data provided.
Label all output as analytical assistance — never state legal clearance or trading approval.
Respond in JSON with keys: summary, risk_narrative, unanswered_questions (array), document_requests (array), evidence_citations (array citing exact evidence items from input).`
	userPrompt := fmt.Sprintf("Deal grounding (JSON):\n%s\n\nFocus: %s", grounding, strings.TrimSpace(req.Focus))
	if userPrompt == "" {
		userPrompt = grounding
	}

	raw, tier, err := llmClient.Complete(ctx, systemPrompt, userPrompt)
	if err != nil {
		resp.Message = err.Error()
		return resp, nil
	}
	resp.Tier = tier

	var parsed struct {
		Summary             string   `json:"summary"`
		RiskNarrative       string   `json:"risk_narrative"`
		UnansweredQuestions []string `json:"unanswered_questions"`
		DocumentRequests    []string `json:"document_requests"`
		EvidenceCitations   []string `json:"evidence_citations"`
	}
	if err := json.Unmarshal([]byte(extractJSON(raw)), &parsed); err != nil {
		resp.Summary = raw
		resp.Message = "LLM returned non-JSON — showing raw draft"
		return resp, nil
	}
	resp.Summary = parsed.Summary
	resp.RiskNarrative = parsed.RiskNarrative
	resp.UnansweredQuestions = parsed.UnansweredQuestions
	resp.DocumentRequests = parsed.DocumentRequests
	resp.EvidenceCitations = parsed.EvidenceCitations
	return resp, nil
}

func buildDDGrounding(pack map[string]any) string {
	sections, _ := pack["sections"].(map[string]any)
	if sections == nil {
		sections = map[string]any{}
	}
	slim := map[string]any{
		"deal_id":              pack["deal_id"],
		"deal_summary":         pack["deal_summary"],
		"parties":              pack["parties"],
		"supply_web":           pack["supply_web"],
		"price_context":        pack["price_context"],
		"limitations":          pack["limitations"],
		"dd_checks":            sections["dd_checks"],
		"sanctions_screening":  sections["sanctions_screening"],
		"red_flags":            sections["red_flags"],
		"positive_evidence":    sections["positive_evidence"],
		"missing_documents":    sections["missing_documents"],
		"recommended_questions": sections["recommended_questions"],
	}
	b, _ := json.MarshalIndent(slim, "", "  ")
	return string(b)
}

func extractJSON(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		if idx := strings.LastIndex(s, "```"); idx >= 0 {
			s = s[:idx]
		}
	}
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		return s[start : end+1]
	}
	return s
}

func (s *Service) buildSupplyWeb(ctx context.Context, seller, location, commodity string) map[string]any {
	eng := supplyweb.New(s.pool)
	res, err := eng.Evaluate(ctx, supplyweb.Query{
		Supplier: seller, Location: location, Commodity: commodity,
	})
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	b, _ := json.Marshal(res)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	return out
}
