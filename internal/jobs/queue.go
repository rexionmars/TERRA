/*
Package jobs runs analyses one after another, away from the studio that queued
them.

A run started from the band is one analysis over the area in hand, and the
reader waits on it. A job is the same analysis queued over an area that is not
in hand -- one of the fields of an area, most often, where the question is the
same for every field and the answer is wanted for all of them. The queue holds
them, runs them in the order they arrived, and says where each one is.

ONE AT A TIME. Every analysis is a Python process that reads a stack of scenes
into memory, and the classification's networks load their weights on top of
that. Two at once would double the peak, and the queue is the one place that
can bound it: runs from the band are started by a reader who can see what is
already going.

What a job runs is a function the caller hands in (Work). The queue knows
nothing of products, requests or the store; it knows order, state and
cancellation, which is the part worth testing on its own.
*/
package jobs

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// State is where a job stands.
type State string

const (
	Queued    State = "queued"
	Running   State = "running"
	Done      State = "done"
	Failed    State = "failed"
	Cancelled State = "cancelled"
)

// finished reports whether a job in this state will not run again unless
// retried.
func (s State) finished() bool {
	return s == Done || s == Failed || s == Cancelled
}

// Job is one analysis over one area, as the studio lists it.
type Job struct {
	ID string `json:"id"`
	// Kind names the product ("classify", "water", "mineral"); the queue only
	// carries it.
	Kind     string `json:"kind"`
	AreaID   string `json:"area_id"`
	AreaName string `json:"area_name"`
	State    State  `json:"state"`
	// Progress is the last percentage the analysis reported, 0-100.
	Progress int `json:"progress"`
	// Message is the last line the analysis reported.
	Message string `json:"message"`
	// RunID is the run the analysis recorded, once it is Done.
	RunID string `json:"run_id"`
	// Error says why a Failed job failed.
	Error string `json:"error"`
	// RFC 3339, empty until the job reaches each point.
	QueuedAt   string `json:"queued_at"`
	StartedAt  string `json:"started_at"`
	FinishedAt string `json:"finished_at"`
}

/*
Work is what a job runs: an analysis that reports its progress through report
and returns the id of the run it recorded.

An empty id with no error is a failure of the job. saveRun withdraws its claim
to have recorded a run by returning nothing, and a job exists to leave a
recorded run behind: an answer that reached no one is not one.
*/
type Work func(ctx context.Context, report func(progress int, message string)) (runID string, err error)

// ErrNotRecorded is the error of a job whose analysis returned no run.
var ErrNotRecorded = errors.New("the analysis finished but its run could not be recorded")

type entry struct {
	job  Job
	work Work
	// Set while the job runs; cancelling calls it.
	cancel context.CancelFunc
	// Whether the reader cancelled it, which is what tells a cancelled run
	// apart from one that failed on its own after its context ended.
	cancelled bool
}

/*
Queue runs its jobs one at a time, in the order they were added.

notify receives the whole list whenever a job is added, starts, ends or is
removed; progress receives one job whenever it reports. Both are called with the
queue's lock held, so what they receive arrives in the order it happened -- two
lists built on two goroutines and emitted outside the lock can reach the
interface in either order, and the older one would be drawn last. They must not
call back into the queue.
*/
type Queue struct {
	base     context.Context
	notify   func([]Job)
	progress func(Job)
	now      func() time.Time

	mu      sync.Mutex
	entries []*entry
	seq     int
	busy    bool
	closed  bool
	// Closed when the worker has nothing left to run; see Wait.
	idle chan struct{}
}

// New returns an empty queue whose jobs run under base.
func New(base context.Context, notify func([]Job), progress func(Job)) *Queue {
	if notify == nil {
		notify = func([]Job) {}
	}
	if progress == nil {
		progress = func(Job) {}
	}
	idle := make(chan struct{})
	close(idle)
	return &Queue{base: base, notify: notify, progress: progress, now: time.Now, idle: idle}
}

// Add queues one job and returns it as queued.
func (q *Queue) Add(kind, areaID, areaName string, work Work) (Job, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return Job{}, errors.New("the job queue is closed")
	}
	q.seq++
	e := &entry{
		job: Job{
			ID:       fmt.Sprintf("job-%d", q.seq),
			Kind:     kind,
			AreaID:   areaID,
			AreaName: areaName,
			State:    Queued,
			QueuedAt: q.stamp(),
		},
		work: work,
	}
	q.entries = append(q.entries, e)
	q.startLocked()
	q.notifyLocked()
	return e.job, nil
}

// List returns every job, in the order they were added.
func (q *Queue) List() []Job {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.listLocked()
}

// Pending counts the jobs that have not finished: queued or running.
func (q *Queue) Pending() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	n := 0
	for _, e := range q.entries {
		if !e.job.State.finished() {
			n++
		}
	}
	return n
}

/*
Cancel stops one job. A queued job is marked cancelled and never starts; a
running one has its context cancelled, which ends the analysis's process, and is
marked cancelled when its work returns.
*/
func (q *Queue) Cancel(id string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	e := q.findLocked(id)
	if e == nil {
		return fmt.Errorf("no job %q", id)
	}
	if q.cancelLocked(e) {
		q.notifyLocked()
	}
	return nil
}

// CancelAll stops every job that has not finished.
func (q *Queue) CancelAll() {
	q.mu.Lock()
	defer q.mu.Unlock()
	changed := false
	for _, e := range q.entries {
		if q.cancelLocked(e) {
			changed = true
		}
	}
	if changed {
		q.notifyLocked()
	}
}

/*
Retry queues a failed or cancelled job again, at the end of the queue: it is
asked for after everything already waiting, and running it ahead of them would
reorder what the reader queued.
*/
func (q *Queue) Retry(id string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return errors.New("the job queue is closed")
	}
	e := q.findLocked(id)
	if e == nil {
		return fmt.Errorf("no job %q", id)
	}
	if e.job.State != Failed && e.job.State != Cancelled {
		return fmt.Errorf("job %q is %s; only a failed or cancelled job is retried", id, e.job.State)
	}
	q.removeLocked(e)
	e.job.State = Queued
	e.job.Progress = 0
	e.job.Message = ""
	e.job.Error = ""
	e.job.RunID = ""
	e.job.QueuedAt = q.stamp()
	e.job.StartedAt = ""
	e.job.FinishedAt = ""
	e.cancelled = false
	q.entries = append(q.entries, e)
	q.startLocked()
	q.notifyLocked()
	return nil
}

// Clear removes every finished job from the list. Their runs stay recorded.
func (q *Queue) Clear() {
	q.mu.Lock()
	defer q.mu.Unlock()
	kept := q.entries[:0]
	for _, e := range q.entries {
		if !e.job.State.finished() {
			kept = append(kept, e)
		}
	}
	if len(kept) == len(q.entries) {
		return
	}
	// The tail is cleared so a removed entry's closure, which holds its
	// request, is not kept alive by the backing array.
	for i := len(kept); i < len(q.entries); i++ {
		q.entries[i] = nil
	}
	q.entries = kept
	q.notifyLocked()
}

/*
Close cancels everything and refuses further jobs. Called when the application
shuts down: the analysis's process is a child that would otherwise outlive the
window it was started from.
*/
func (q *Queue) Close() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return
	}
	q.closed = true
	for _, e := range q.entries {
		q.cancelLocked(e)
	}
	q.notifyLocked()
}

// Wait blocks until the worker has nothing left to run, or ctx ends.
func (q *Queue) Wait(ctx context.Context) error {
	q.mu.Lock()
	idle := q.idle
	q.mu.Unlock()
	select {
	case <-idle:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (q *Queue) cancelLocked(e *entry) bool {
	switch e.job.State {
	case Queued:
		e.cancelled = true
		e.job.State = Cancelled
		e.job.FinishedAt = q.stamp()
		return true
	case Running:
		if e.cancelled {
			return false
		}
		e.cancelled = true
		if e.cancel != nil {
			e.cancel()
		}
		e.job.Message = "cancelling"
		return true
	}
	return false
}

func (q *Queue) startLocked() {
	if q.busy || q.closed {
		return
	}
	q.busy = true
	q.idle = make(chan struct{})
	go q.loop(q.idle)
}

// loop runs queued jobs until none is left, then closes idle.
func (q *Queue) loop(idle chan struct{}) {
	for {
		q.mu.Lock()
		e := q.nextLocked()
		if e == nil || q.closed {
			q.busy = false
			close(idle)
			q.mu.Unlock()
			return
		}
		ctx, cancel := context.WithCancel(q.base)
		e.cancel = cancel
		e.job.State = Running
		e.job.StartedAt = q.stamp()
		e.job.Message = "starting"
		q.notifyLocked()
		work := e.work
		q.mu.Unlock()

		runID, err := q.run(ctx, work, e)
		cancel()

		q.mu.Lock()
		e.cancel = nil
		e.job.FinishedAt = q.stamp()
		switch {
		case e.cancelled:
			e.job.State = Cancelled
			e.job.Message = ""
		case err != nil:
			e.job.State = Failed
			e.job.Error = err.Error()
		case runID == "":
			e.job.State = Failed
			e.job.Error = ErrNotRecorded.Error()
		default:
			e.job.State = Done
			e.job.RunID = runID
			e.job.Progress = 100
		}
		q.notifyLocked()
		q.mu.Unlock()
	}
}

// run calls the work with its progress routed to this job, and turns a panic
// in it into the job's failure rather than the application's end.
func (q *Queue) run(ctx context.Context, work Work, e *entry) (runID string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("the analysis stopped unexpectedly: %v", r)
		}
	}()
	return work(ctx, func(progress int, message string) {
		q.mu.Lock()
		defer q.mu.Unlock()
		if e.job.State != Running || e.cancelled {
			return
		}
		// Negative means "a line with no percentage": the bar stays put.
		if progress >= 0 {
			e.job.Progress = min(progress, 100)
		}
		if message != "" {
			e.job.Message = message
		}
		q.progress(e.job)
	})
}

func (q *Queue) nextLocked() *entry {
	for _, e := range q.entries {
		if e.job.State == Queued {
			return e
		}
	}
	return nil
}

func (q *Queue) findLocked(id string) *entry {
	for _, e := range q.entries {
		if e.job.ID == id {
			return e
		}
	}
	return nil
}

func (q *Queue) removeLocked(target *entry) {
	for i, e := range q.entries {
		if e == target {
			q.entries = append(q.entries[:i], q.entries[i+1:]...)
			return
		}
	}
}

func (q *Queue) listLocked() []Job {
	out := make([]Job, len(q.entries))
	for i, e := range q.entries {
		out[i] = e.job
	}
	return out
}

func (q *Queue) notifyLocked() {
	q.notify(q.listLocked())
}

func (q *Queue) stamp() string {
	return q.now().UTC().Format(time.RFC3339)
}
