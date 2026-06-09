package mapserving

import (
	"fmt"
	"strings"
)

const (
	FusionTerminalMaxM = 2500
	FusionGemPipelineM = 2000
)

func OsmFeatureKey(layerID, osmType string, osmID int64) string {
	return fmt.Sprintf("osm:%s:%s:%d",
		strings.TrimSpace(layerID),
		strings.TrimSpace(osmType),
		osmID,
	)
}

func GemPipelineFeatureKey(segmentKey string) string {
	return "gem:pipeline:" + strings.TrimSpace(segmentKey)
}
