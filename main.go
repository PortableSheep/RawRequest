package main

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"rawrequest/internal/cli"
	mcpserver "rawrequest/internal/mcp"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed examples/*
var examplesFS embed.FS

func main() {
	// Check for CLI mode
	if opts := cli.Parse(os.Args); opts != nil {
		if opts.Command == cli.CommandMCP {
			if err := startMCPServer(opts); err != nil {
				fmt.Fprintf(os.Stderr, "MCP server error: %v\n", err)
				os.Exit(1)
			}
			os.Exit(0)
		}
		exitCode := cli.Run(opts, Version)
		os.Exit(exitCode)
	}

	// GUI mode - Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "RawRequest",
		Width:     1024,
		Height:    768,
		MinWidth:  400,
		MinHeight: 300,
		Mac: &mac.Options{
			DisableZoom: false,
			TitleBar:    mac.TitleBarDefault(),
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 9, G: 9, B: 11, A: 1}, // zinc-950
		OnStartup:        app.startup,
		OnDomReady:       app.onDomReady,
		OnBeforeClose:    app.onBeforeClose,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

func startMCPServer(opts *cli.Options) error {
	// Initialize secret vault for {{secret:KEY}} resolution
	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = filepath.Join(os.Getenv("HOME"), ".config")
	}
	vaultDir := filepath.Join(configDir, "rawrequest", "secrets")

	var secretResolver cli.SecretResolver
	vault, err := NewSecretVault(vaultDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: secret vault unavailable: %v\n", err)
	} else {
		secretResolver = vault
	}

	return mcpserver.Serve(mcpserver.Options{
		DefaultEnv:     opts.Environment,
		SecretResolver: secretResolver,
		Version:        Version,
	})
}
