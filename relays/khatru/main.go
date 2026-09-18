// khatru — a small custom relay built with fiatjaf's khatru framework (fiatjaf.com/nostr/khatru).
// It shows what khatru is for: a relay is a few lines plus the policies you decide on.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore/lmdb"
	"fiatjaf.com/nostr/khatru"
)

// Kinds that must never sit on a relay unwrapped (nostr-gate seals and epoch key rumors).
var neverStore = map[nostr.Kind]string{
	13:    "blocked: seals (kind 13) travel inside gift wraps, never on their own",
	21088: "blocked: epoch key rumors (kind 21088) must be gift-wrapped",
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func main() {
	relay := khatru.NewRelay()
	relay.Info.Name = "khatru"
	relay.Info.Description = "fiatjaf.com/nostr/khatru · local test relay with a nostr-gate hygiene policy"
	relay.Info.Software = "https://pkg.go.dev/fiatjaf.com/nostr/khatru"
	relay.Info.Version = env("KHATRU_VERSION", "dev")
	relay.Negentropy = true // NIP-77 set reconciliation, like strfry

	// Storage: LMDB on disk, at most 500 events per query.
	db := &lmdb.LMDBBackend{Path: env("DATA_PATH", "./data")}
	if err := os.MkdirAll(db.Path, 0o755); err != nil {
		log.Fatal(err)
	}
	if err := db.Init(); err != nil {
		log.Fatal(err)
	}
	relay.UseEventstore(db, 500)

	// Policy: refuse the two kinds that leak private material when published unwrapped.
	relay.OnEvent = func(ctx context.Context, event nostr.Event) (bool, string) {
		if msg, blocked := neverStore[event.Kind]; blocked {
			return true, msg
		}
		return false, ""
	}

	addr := env("HOST", "0.0.0.0") + ":" + env("PORT", "3334")
	fmt.Println("khatru relay listening on", addr)
	log.Fatal(http.ListenAndServe(addr, relay))
}
