package main

import (
	"context"
	"errors"
	"fmt"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/jobs"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// The job queue as the interface reaches it: analyses queued over areas that
// are not in hand, most often the fields of one area, and run one after
// another by internal/jobs. Each job is the same analysis the band starts,
// through the same method, recorded as the same kind of run.

// The products a job can run. The field delineation is not one: it runs over an
// area to make its fields, and the queue exists for the fields once they are
// made.
const (
	JobClassify = "classify"
	JobWater    = "water"
	JobMineral  = "mineral"
)

/*
JobSpec is one analysis over one area, as the studio asks for it.

The request is built there, from the band's parameters and the area's own
polygon, exactly as a run started from the band is -- so a job and a run from
the band cannot differ in anything but the ground they cover. One field per
product rather than one untyped payload, so the bindings carry each request's
type to the interface.
*/
type JobSpec struct {
	Kind string `json:"kind"`
	// AreaName is what the job list calls the area; the request's AreaID is
	// which one it is.
	AreaName string                   `json:"area_name"`
	Classify *analysis.PredictRequest `json:"classify,omitempty"`
	Water    *analysis.WaterRequest   `json:"water,omitempty"`
	Mineral  *analysis.MineralRequest `json:"mineral,omitempty"`
}

// startJobs creates the queue, announcing its changes to the interface.
func (a *App) startJobs(ctx context.Context) {
	q := jobs.New(ctx,
		func(list []jobs.Job) { wruntime.EventsEmit(ctx, "jobs:changed", list) },
		func(job jobs.Job) { wruntime.EventsEmit(ctx, "jobs:progress", job) },
	)
	a.mu.Lock()
	a.jobs = q
	a.mu.Unlock()
}

// jobQueue is the queue, or nil before startup; read under the lock for the
// reason currentRunner gives.
func (a *App) jobQueue() *jobs.Queue {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.jobs
}

// shutdown cancels what the queue holds: a running analysis is a child process
// that would outlive the window.
func (a *App) shutdown(context.Context) {
	if q := a.jobQueue(); q != nil {
		q.Close()
	}
}

/*
QueueJobs adds one job per spec, in order, and returns them as queued.

ALL OR NONE. Every spec is checked before any is added, so a list refused for
its seventh entry has not left six jobs running that the reader then has to
find and cancel.
*/
func (a *App) QueueJobs(specs []JobSpec) ([]jobs.Job, error) {
	q := a.jobQueue()
	if q == nil {
		return nil, errors.New("the job queue has not started")
	}
	if len(specs) == 0 {
		return nil, errors.New("no jobs to queue")
	}
	type prepared struct {
		spec   JobSpec
		areaID string
		work   jobs.Work
	}
	ready := make([]prepared, 0, len(specs))
	for i, spec := range specs {
		areaID, work, err := a.jobWork(spec)
		if err != nil {
			return nil, fmt.Errorf("job %d of %d: %w", i+1, len(specs), err)
		}
		ready = append(ready, prepared{spec: spec, areaID: areaID, work: work})
	}
	out := make([]jobs.Job, 0, len(ready))
	for _, p := range ready {
		job, err := q.Add(p.spec.Kind, p.areaID, p.spec.AreaName, p.work)
		if err != nil {
			return out, err
		}
		out = append(out, job)
	}
	return out, nil
}

// ListJobs returns every job the queue holds, in the order they were added.
func (a *App) ListJobs() []jobs.Job {
	q := a.jobQueue()
	if q == nil {
		return []jobs.Job{}
	}
	return q.List()
}

// CancelJob stops one job: a queued one never starts, a running one has its
// analysis's process ended.
func (a *App) CancelJob(id string) error {
	q := a.jobQueue()
	if q == nil {
		return errors.New("the job queue has not started")
	}
	return q.Cancel(id)
}

// CancelAllJobs stops every job that has not finished.
func (a *App) CancelAllJobs() {
	if q := a.jobQueue(); q != nil {
		q.CancelAll()
	}
}

// RetryJob queues a failed or cancelled job again, at the end of the queue.
func (a *App) RetryJob(id string) error {
	q := a.jobQueue()
	if q == nil {
		return errors.New("the job queue has not started")
	}
	return q.Retry(id)
}

// ClearJobs removes the finished jobs from the list; their runs stay recorded.
func (a *App) ClearJobs() {
	if q := a.jobQueue(); q != nil {
		q.Clear()
	}
}

/*
jobWork checks one spec and returns the area it runs over and the work that
runs it.

A job must name an area of the catalog. The list names each job by its area and
opening a finished one activates that area; a job over a bare polygon would be a
row that leads nowhere.
*/
func (a *App) jobWork(spec JobSpec) (string, jobs.Work, error) {
	switch spec.Kind {
	case JobClassify:
		req := spec.Classify
		if req == nil {
			return "", nil, errors.New("a classification job carries no request")
		}
		if err := jobGround(req.PolygonGeoJSON, req.AreaID); err != nil {
			return "", nil, err
		}
		return req.AreaID, func(ctx context.Context, report func(int, string)) (string, error) {
			res, err := a.predict(analysis.WithProgress(ctx, relay(report)), *req)
			if err != nil {
				return "", err
			}
			return res.RunID, nil
		}, nil
	case JobWater:
		req := spec.Water
		if req == nil {
			return "", nil, errors.New("a surface water job carries no request")
		}
		if err := jobGround(req.PolygonGeoJSON, req.AreaID); err != nil {
			return "", nil, err
		}
		return req.AreaID, func(ctx context.Context, report func(int, string)) (string, error) {
			res, err := a.analyzeWater(analysis.WithProgress(ctx, relay(report)), *req)
			if err != nil {
				return "", err
			}
			return res.RunID, nil
		}, nil
	case JobMineral:
		req := spec.Mineral
		if req == nil {
			return "", nil, errors.New("a mineral map job carries no request")
		}
		if err := jobGround(req.PolygonGeoJSON, req.AreaID); err != nil {
			return "", nil, err
		}
		return req.AreaID, func(ctx context.Context, report func(int, string)) (string, error) {
			res, err := a.analyzeMinerals(analysis.WithProgress(ctx, relay(report)), *req)
			if err != nil {
				return "", err
			}
			return res.RunID, nil
		}, nil
	}
	return "", nil, fmt.Errorf("no product %q runs as a job", spec.Kind)
}

func jobGround(polygon *analysis.GeoJSONGeometry, areaID string) error {
	if polygon == nil {
		return errors.New("the job has no polygon to run over")
	}
	if areaID == "" {
		return errors.New("the job names no area")
	}
	return nil
}

// relay turns the runner's progress lines into the queue's report calls.
func relay(report func(int, string)) func(analysis.ProgressEvent) {
	return func(ev analysis.ProgressEvent) { report(ev.Progress, ev.Msg) }
}
