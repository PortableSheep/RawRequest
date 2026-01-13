package main

type ExamplesForFirstRunResponse struct {
	Content    string `json:"content"`
	FilePath   string `json:"filePath"`
	IsFirstRun bool   `json:"isFirstRun"`
}

func (a *App) GetExamplesForFirstRun() (*ExamplesForFirstRunResponse, error) {
	if !a.IsFirstRun() {
		return &ExamplesForFirstRunResponse{Content: "", FilePath: "", IsFirstRun: false}, nil
	}

	content, err := examplesFS.ReadFile("examples/examples.http")
	if err != nil {
		return nil, err
	}

	return &ExamplesForFirstRunResponse{Content: string(content), FilePath: "examples.http", IsFirstRun: true}, nil
}

func (a *App) GetExamplesFile() (*ExamplesForFirstRunResponse, error) {
	content, err := examplesFS.ReadFile("examples/examples.http")
	if err != nil {
		return nil, err
	}
	return &ExamplesForFirstRunResponse{Content: string(content), FilePath: "examples.http", IsFirstRun: false}, nil
}
