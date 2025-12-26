package loadtest

import "testing"

func TestDeriveSpawnRate_UsesExistingWhenPresent(t *testing.T) {
	rate, has := DeriveSpawnRate(7, true, true, 1000, 10)
	if !has || rate != 7 {
		t.Fatalf("expected existing rate 7, got %d has=%v", rate, has)
	}
}

func TestDeriveSpawnRate_NoRampUp_NoDerivation(t *testing.T) {
	rate, has := DeriveSpawnRate(0, false, false, 5000, 10)
	if has {
		t.Fatalf("expected has=false")
	}
	if rate != 0 {
		t.Fatalf("expected rate 0, got %d", rate)
	}
}

func TestDeriveSpawnRate_DerivesFromRampUp(t *testing.T) {
	// remaining=10 over 2s => ceil(5) = 5 users/sec
	rate, has := DeriveSpawnRate(0, false, true, 2000, 10)
	if !has || rate != 5 {
		t.Fatalf("expected rate 5 has=true, got %d has=%v", rate, has)
	}
}

func TestDeriveSpawnRate_ClampsToAtLeastOne(t *testing.T) {
	// remaining=1 over 10s => ceil(0.1) => 1
	rate, has := DeriveSpawnRate(0, false, true, 10000, 1)
	if !has || rate != 1 {
		t.Fatalf("expected rate 1 has=true, got %d has=%v", rate, has)
	}
}

func TestDeriveSpawnRate_ZeroOrNegativeRampUpMs_NoDerivation(t *testing.T) {
	_, has := DeriveSpawnRate(0, false, true, 0, 10)
	if has {
		t.Fatalf("expected has=false")
	}
}
