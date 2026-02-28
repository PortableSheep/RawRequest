package cli

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

// Command represents the CLI command to execute
type Command string

const (
	CommandNone    Command = ""
	CommandRun     Command = "run"
	CommandList    Command = "list"
	CommandEnvs    Command = "envs"
	CommandMCP     Command = "mcp"
	CommandService Command = "service"
	CommandLoad    Command = "load"
	CommandVersion Command = "version"
	CommandHelp    Command = "help"
)

// OutputFormat specifies how to format the response
type OutputFormat string

const (
	OutputJSON  OutputFormat = "json"
	OutputBody  OutputFormat = "body"
	OutputFull  OutputFormat = "full"
	OutputQuiet OutputFormat = "quiet"
)

// Options holds all CLI configuration
type Options struct {
	Command      Command
	File         string
	RequestNames []string
	Environment  string
	Variables    map[string]string
	Timeout      int
	Output       OutputFormat
	Verbose      bool
	NoScripts    bool
	ServiceAddr  string
	ShowHelp     bool
	// Load test options
	LoadUsers    int
	LoadDuration string  // e.g. "30s", "2m"
	LoadRPS      int
	LoadRampUp   string  // e.g. "10s"
	LoadFailRate float64
	LoadAdaptive bool
	Workspace    string  // MCP workspace root
}

// Parse parses command line arguments and returns Options.
// Returns nil if the app should run in GUI mode.
func Parse(args []string) *Options {
	if len(args) < 2 {
		return nil // No arguments, run GUI
	}

	// Check if first argument is a command
	cmd := strings.ToLower(args[1])
	switch cmd {
	case "run", "list", "envs", "mcp", "service", "load", "version", "help", "--help", "-h", "--version", "-v":
		// CLI mode
	default:
		return nil // Unknown command, run GUI
	}

	opts := &Options{
		Variables:   make(map[string]string),
		Environment: "default",
		Output:      OutputFull,
		ServiceAddr: "127.0.0.1:7345",
	}

	// Handle simple commands
	switch cmd {
	case "version", "--version", "-v":
		opts.Command = CommandVersion
		return opts
	case "help", "--help", "-h":
		opts.Command = CommandHelp
		return opts
	}

	opts.Command = Command(cmd)

	// MCP command: no file required, optional --env flag
	if opts.Command == CommandMCP {
		fs := flag.NewFlagSet("rawrequest-mcp", flag.ContinueOnError)
		fs.SetOutput(os.Stderr)
		fs.StringVar(&opts.Environment, "env", "", "Default environment to use")
		fs.StringVar(&opts.Environment, "e", "", "Default environment (shorthand)")
		fs.StringVar(&opts.Workspace, "workspace", ".", "Workspace root for file discovery")
		fs.StringVar(&opts.Workspace, "w", ".", "Workspace root (shorthand)")
		if len(args) > 2 {
			if err := fs.Parse(args[2:]); err != nil {
				opts.ShowHelp = true
			}
		}
		return opts
	}

	if opts.Command == CommandLoad {
		// Need at least a file argument
		if len(args) < 3 {
			opts.ShowHelp = true
			return opts
		}
		opts.File = args[2]

		fs := flag.NewFlagSet("rawrequest-load", flag.ContinueOnError)
		fs.SetOutput(os.Stderr)

		var names stringSlice
		var vars stringSlice

		fs.Var(&names, "name", "Request name to load test (required)")
		fs.Var(&names, "n", "Request name (shorthand)")
		fs.StringVar(&opts.Environment, "env", "default", "Environment to use")
		fs.StringVar(&opts.Environment, "e", "default", "Environment (shorthand)")
		fs.Var(&vars, "var", "Set variable: key=value (can be repeated)")
		fs.Var(&vars, "V", "Set variable (shorthand)")
		fs.IntVar(&opts.LoadUsers, "users", 10, "Max concurrent users")
		fs.StringVar(&opts.LoadDuration, "duration", "30s", "Test duration (e.g. 30s, 2m)")
		fs.IntVar(&opts.LoadRPS, "rps", 0, "Target requests per second (0=unlimited)")
		fs.StringVar(&opts.LoadRampUp, "ramp-up", "", "Ramp-up time (e.g. 10s)")
		fs.Float64Var(&opts.LoadFailRate, "fail-rate", 0, "Failure rate threshold to abort (0.0-1.0)")
		fs.BoolVar(&opts.LoadAdaptive, "adaptive", false, "Enable adaptive load control")
		fs.StringVar((*string)(&opts.Output), "output", "full", "Output format: full|json|quiet")
		fs.StringVar((*string)(&opts.Output), "o", "full", "Output format (shorthand)")
		fs.StringVar(&opts.ServiceAddr, "service", opts.ServiceAddr, "Service URL (default: auto-start)")
		fs.IntVar(&opts.Timeout, "timeout", 30, "Per-request timeout in seconds")

		if len(args) > 3 {
			if err := fs.Parse(args[3:]); err != nil {
				opts.ShowHelp = true
				return opts
			}
		}

		opts.RequestNames = []string(names)
		for _, v := range vars {
			if idx := strings.Index(v, "="); idx > 0 {
				opts.Variables[v[:idx]] = v[idx+1:]
			}
		}

		return opts
	}

	if opts.Command == CommandService {
		fs := flag.NewFlagSet("rawrequest-service", flag.ContinueOnError)
		fs.SetOutput(os.Stderr)
		fs.StringVar(&opts.ServiceAddr, "addr", opts.ServiceAddr, "Address to bind service (host:port)")
		if len(args) > 2 {
			if err := fs.Parse(args[2:]); err != nil {
				opts.ShowHelp = true
			}
		}
		return opts
	}

	// Need at least a file argument for run/list/envs
	if len(args) < 3 {
		if opts.Command == CommandRun || opts.Command == CommandList || opts.Command == CommandEnvs {
			opts.ShowHelp = true
			return opts
		}
	}

	// Parse remaining arguments
	fs := flag.NewFlagSet("rawrequest", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	var names stringSlice
	var vars stringSlice

	fs.Var(&names, "name", "Request name to execute (can be repeated)")
	fs.Var(&names, "n", "Request name to execute (shorthand)")
	fs.StringVar(&opts.Environment, "env", "default", "Environment to use")
	fs.StringVar(&opts.Environment, "e", "default", "Environment to use (shorthand)")
	fs.Var(&vars, "var", "Set variable: key=value (can be repeated)")
	fs.Var(&vars, "V", "Set variable (shorthand)")
	fs.IntVar(&opts.Timeout, "timeout", 30, "Request timeout in seconds")
	fs.StringVar((*string)(&opts.Output), "output", "full", "Output format: json|body|full|quiet")
	fs.StringVar((*string)(&opts.Output), "o", "full", "Output format (shorthand)")
	fs.BoolVar(&opts.Verbose, "verbose", false, "Show request details")
	fs.BoolVar(&opts.NoScripts, "no-scripts", false, "Disable pre/post scripts")

	// File is the first positional argument after the command
	if len(args) >= 3 {
		opts.File = args[2]
	}

	// Parse flags after the file
	if len(args) > 3 {
		if err := fs.Parse(args[3:]); err != nil {
			opts.ShowHelp = true
			return opts
		}
	}

	opts.RequestNames = []string(names)

	// Parse variables
	for _, v := range vars {
		if idx := strings.Index(v, "="); idx > 0 {
			key := v[:idx]
			value := v[idx+1:]
			opts.Variables[key] = value
		}
	}

	return opts
}

// stringSlice is a flag.Value that collects multiple string values
type stringSlice []string

func (s *stringSlice) String() string {
	return strings.Join(*s, ", ")
}

func (s *stringSlice) Set(value string) error {
	*s = append(*s, value)
	return nil
}

// PrintHelp prints the CLI usage information
func PrintHelp(version string) {
	fmt.Printf(`RawRequest %s - HTTP Client

Usage:
  rawrequest                          Launch GUI
  rawrequest run <file> [options]     Execute requests from an .http file
  rawrequest load <file> [options]    Run load tests against requests
  rawrequest list <file>              List all named requests in a file
  rawrequest envs <file>              List environments defined in a file
  rawrequest mcp [options]            Start MCP server for AI assistant integration
  rawrequest version                  Show version
  rawrequest help                     Show this help

Run Options:
  -n, --name <name>      Request name to execute (can be repeated for chains)
                         If omitted, executes all requests in the file
  -e, --env <env>        Environment to use (default: "default")
  -V, --var <key=value>  Set variable (can be repeated)
  --timeout <seconds>    Request timeout in seconds (default: 30)
  -o, --output <format>  Output format: json|body|full|quiet (default: full)
  --verbose              Show request details before execution
  --no-scripts           Disable pre/post scripts

Load Test Options:
  -n, --name <name>      Request name to load test (required)
  -e, --env <env>        Environment to use (default: "default")
  -V, --var <key=value>  Set variable (can be repeated)
  --users <n>            Max concurrent users (default: 10)
  --duration <duration>  Test duration (e.g. 30s, 2m; default: 30s)
  --rps <n>              Target requests per second (0=unlimited)
  --ramp-up <duration>   Ramp-up time to reach max users
  --fail-rate <0.0-1.0>  Failure rate threshold to abort
  --adaptive             Enable adaptive load control
  -o, --output <format>  Output: full|json|quiet (default: full)
  --service <url>        Service URL (default: auto-start on 127.0.0.1:7345)

MCP Options:
  -e, --env <env>        Default environment for requests
  -w, --workspace <dir>  Workspace root for .http file discovery (default: .)

Output Formats:
  json    JSON response with status, headers, body, and timing
  body    Response body only
  full    Human-readable format with status and body
  quiet   No output, exit code only (0=success, 1=failure)

Examples:
  # Run a specific named request
  rawrequest run api.http -n "login"

  # Run multiple chained requests
  rawrequest run api.http -n "login" -n "getProfile"

  # Run with a different environment
  rawrequest run api.http -n "getUsers" -e production

  # Set variables
  rawrequest run api.http -n "createUser" -V "username=john" -V "email=john@example.com"

  # Get just the response body (useful for piping)
  rawrequest run api.http -n "getData" -o body | jq .

  # List all requests in a file
  rawrequest list api.http

  # List environments
  rawrequest envs api.http

  # Run a load test
  rawrequest load api.http -n "getUsers" --users 50 --duration 60s --rps 200

  # Load test with adaptive control
  rawrequest load api.http -n "search" --users 100 --duration 2m --adaptive

  # Start MCP server for AI assistants (Copilot, Claude, etc.)
  rawrequest mcp
  rawrequest mcp --env dev

`, version)
}

// PrintVersion prints just the version string
func PrintVersion(version string) {
	fmt.Printf("RawRequest %s\n", version)
}
