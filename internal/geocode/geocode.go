package geocode

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// GeocodeResult is a single place match from the geocoder.
type GeocodeResult struct {
	DisplayName string  `json:"display_name"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	// BoundingBox is [lat_min, lat_max, lon_min, lon_max] when available.
	BoundingBox []float64 `json:"bounding_box"`
}

// Geocode queries the OpenStreetMap Nominatim service for a place name.
// A descriptive User-Agent is sent as required by the Nominatim usage policy.
func Geocode(ctx context.Context, query string) ([]GeocodeResult, error) {
	if query == "" {
		return []GeocodeResult{}, nil
	}
	endpoint := "https://nominatim.openstreetmap.org/search"
	params := url.Values{}
	params.Set("q", query)
	params.Set("format", "jsonv2")
	params.Set("limit", "5")
	params.Set("addressdetails", "0")

	reqURL := endpoint + "?" + params.Encode()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("User-Agent", "TERRA/1.0 (land-cover classification desktop app)")
	httpReq.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("geocoding request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("geocoding returned HTTP %d", resp.StatusCode)
	}

	// Nominatim returns lat/lon as strings and boundingbox as a string array.
	var raw []struct {
		DisplayName string   `json:"display_name"`
		Lat         string   `json:"lat"`
		Lon         string   `json:"lon"`
		BoundingBox []string `json:"boundingbox"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("failed to parse geocoding response: %w", err)
	}

	results := []GeocodeResult{}
	for _, r := range raw {
		lat, err1 := strconv.ParseFloat(r.Lat, 64)
		lon, err2 := strconv.ParseFloat(r.Lon, 64)
		if err1 != nil || err2 != nil {
			continue
		}
		bbox := []float64{}
		for _, b := range r.BoundingBox {
			if v, err := strconv.ParseFloat(b, 64); err == nil {
				bbox = append(bbox, v)
			}
		}
		results = append(results, GeocodeResult{
			DisplayName: r.DisplayName,
			Lat:         lat,
			Lon:         lon,
			BoundingBox: bbox,
		})
	}
	return results, nil
}
