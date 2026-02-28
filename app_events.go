package main

import (
	"strings"
	"sync"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type appEvent struct {
	Event   string `json:"event"`
	Payload any    `json:"payload"`
}

type appEventBroker struct {
	mu          sync.RWMutex
	nextID      int
	subscribers map[int]chan appEvent
}

func newAppEventBroker() *appEventBroker {
	return &appEventBroker{
		subscribers: make(map[int]chan appEvent),
	}
}

func (b *appEventBroker) publish(event string, payload any) {
	if strings.TrimSpace(event) == "" {
		return
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	msg := appEvent{
		Event:   event,
		Payload: payload,
	}
	for _, ch := range b.subscribers {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (b *appEventBroker) subscribe(buffer int) (<-chan appEvent, func()) {
	if buffer <= 0 {
		buffer = 128
	}

	ch := make(chan appEvent, buffer)

	b.mu.Lock()
	id := b.nextID
	b.nextID++
	b.subscribers[id] = ch
	b.mu.Unlock()

	unsubscribe := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if existing, ok := b.subscribers[id]; ok {
			delete(b.subscribers, id)
			close(existing)
		}
	}

	return ch, unsubscribe
}

func (a *App) emitEvent(event string, payload any) {
	if strings.TrimSpace(event) == "" {
		return
	}
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, event, payload)
	}
	if a.eventBroker != nil {
		a.eventBroker.publish(event, payload)
	}
}

func (a *App) subscribeEvents(buffer int) (<-chan appEvent, func()) {
	if a.eventBroker == nil {
		return nil, func() {}
	}
	return a.eventBroker.subscribe(buffer)
}
