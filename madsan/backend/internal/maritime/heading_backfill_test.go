package maritime

import "testing"

func TestHeadingBackfillBatchSize(t *testing.T) {
	if headingBackfillBatch <= 0 {
		t.Fatal("expected positive batch size")
	}
}
