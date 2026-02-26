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
	ShowHelp     bool
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
	case "run", "list", "envs", "mcp", "version", "help", "--help", "-h", "--version", "-v":
		// CLI mode
	default:
		return nil // Unknown command, run GUI
	}

	opts := &Options{
		Variables:   make(map[string]string),
		Environment: "default",
		Output:      OutputFull,
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

MCP Options:
  -e, --env <env>        Default environment for requests

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

  # Start MCP server for AI assistants (Copilot, Claude, etc.)
  rawrequest mcp
  rawrequest mcp --env dev

`, version)
}

// PrintVersion prints just the version string
func PrintVersion(version string) {
	fmt.Printf("RawRequest %s\n", version)
}
