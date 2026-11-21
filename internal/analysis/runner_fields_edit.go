package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// SplitField cuts a field along a line drawn across it, and returns its
// parts, largest first. The field is the GeoJSON Polygon text the store
// holds; the sidecar refuses a line that does not cross it from edge to edge.
func (r *Runner) SplitField(ctx context.Context, field string, line GeoJSONLine) ([]FieldPart, error) {
	if line.Type != "LineString" || len(line.Coordinates) < 2 {
		return nil, errors.New("the cut has to be a line of at least two points")
	}
	parts, err := r.editFields(ctx, map[string]any{
		"op":    "split",
		"field": json.RawMessage(field),
		"line":  line,
	})
	if err != nil {
		return nil, err
	}
	if len(parts) < 2 {
		return nil, fmt.Errorf("the cut returned %d parts, not two or more", len(parts))
	}
	return parts, nil
}

// JoinFields makes neighbouring fields one, across the strip the delineation
// leaves between them; the sidecar refuses fields that are not neighbours.
func (r *Runner) JoinFields(ctx context.Context, fields []string) (*FieldPart, error) {
	if len(fields) < 2 {
		return nil, errors.New("choose at least two fields to join")
	}
	raw := make([]json.RawMessage, len(fields))
	for i, f := range fields {
		raw[i] = json.RawMessage(f)
	}
	parts, err := r.editFields(ctx, map[string]any{"op": "join", "fields": raw})
	if err != nil {
		return nil, err
	}
	if len(parts) != 1 {
		return nil, fmt.Errorf("the join returned %d fields, not one", len(parts))
	}
	return &parts[0], nil
}

func (r *Runner) editFields(ctx context.Context, payload map[string]any) ([]FieldPart, error) {
	payload["action"] = "field_edit"
	reqBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}
	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	return parseFieldEdit([]byte(raw))
}

// parseFieldEdit reads the sidecar's `field_edit` object, refusing a part
// that is not a Polygon: a field is one polygon (app_fields.go AdoptFields).
func parseFieldEdit(raw []byte) ([]FieldPart, error) {
	var wrapped struct {
		Edit *fieldEditSidecarResult `json:"field_edit"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse the field edit: %w", err)
	}
	if wrapped.Edit == nil {
		return nil, errors.New("sidecar returned an empty field edit")
	}
	for i, p := range wrapped.Edit.Parts {
		if p.Geometry.Type != "Polygon" || len(p.Geometry.Coordinates) == 0 {
			return nil, fmt.Errorf("part %d of the field edit is not a polygon", i+1)
		}
	}
	return wrapped.Edit.Parts, nil
}
