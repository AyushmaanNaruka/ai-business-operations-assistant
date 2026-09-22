# The assignment, verbatim

Received from Nancy Joseph, Mon 21 September 2026, 19:22.
Due **Monday 28 September 2026, 12:00 PM**.

---

## AI Business Operations Assistant

### Problem

Business teams regularly work with a mixture of information scattered across websites, documents, spreadsheets, and other files.

A marketing or sales team might receive a company brief, campaign data in an Excel file, customer information in documents, and a set of research requirements. Turning all of this information into useful insights and business-ready deliverables often requires significant manual effort.

Build an AI-powered assistant that can help a business user work with this information through a conversational interface.

The user should be able to provide files and/or a company website and ask questions or request work such as:

- "Analyze this campaign data and tell me what performed well and what didn't."
- "Based on this data and the company information, suggest three campaign ideas."
- "Create a report summarizing the findings."
- "Turn the findings into a presentation."
- "Create an Excel file containing the recommendations and supporting data."
- "Research this company and combine the findings with the data I uploaded."

The assistant should be capable of understanding the user's intent, working with the available information, performing analysis where required, and producing a useful final result.

### Files and Data

The system should support working with multiple types of business information, such as:

- PDF/document files
- Excel/CSV files
- Text files
- Public webpages

The assistant should be able to reason across information from multiple sources.

For example, a user might upload campaign performance data and a company brief and ask: "Analyze our previous campaigns and recommend what we should do for this company."

The response should be based on the actual information contained in the provided sources.

### Analysis

The assistant should be able to perform meaningful analysis on structured data.

For example, given campaign data, a user might ask:

- "Which campaigns performed best?"
- "Which audience segment has the highest conversion rate?"
- "What trends do you see?"
- "What should we change in the next campaign?"

The system should perform the necessary calculations rather than relying on the language model to estimate numerical results.

Where appropriate, the assistant should explain how it arrived at important conclusions.

### Business Deliverables

The assistant should be capable of turning its work into useful business artifacts. Depending on the user's request, this could include:

- A structured report
- An Excel spreadsheet
- A presentation
- A summary document
- A content brief
- A campaign plan
- Other appropriate business outputs

Generated files should contain meaningful, usable content rather than simply copying the model's response into a file.

### Research

The assistant should also be capable of researching information available on the public web when required.

For example: "Research this company, analyze the campaign data I uploaded, and prepare a campaign strategy based on both."

The system should be able to combine information discovered through research with information provided by the user.

Important claims and conclusions should be traceable to their underlying information where appropriate.

### Conversational Workflow

The interaction should remain conversational. For example:

```
User: Analyze this campaign data.
Assistant: [Analysis]
User: Now compare it with the target company's audience.
Assistant: [Analysis using previous context and available information]
User: Great. Turn this into a campaign proposal.
Assistant: [Generated proposal]
User: Put the campaign metrics into an Excel file and create a presentation for the client.
Assistant: [Generated files]
```

The system should maintain sufficient context to support this type of workflow.

### Requirements

The application must be built using:

- TypeScript
- Mastra

The system should use a multi-agent architecture where appropriate.

There is no prescribed architecture. You should determine how the system should divide responsibilities and coordinate different types of work.

### Engineering Expectations

Consider how your system should handle:

- Different types of files
- Large files
- Structured and unstructured information
- Numerical analysis
- Multiple sources of information
- Long-running tasks
- Errors and failed operations
- Unsupported requests
- Conflicting information
- Generated artifacts
- Conversation context
- Cost and latency

The system should avoid fabricating information when the required data is unavailable.

For numerical analysis, calculations should be performed programmatically where appropriate rather than relying solely on an LLM.

### Deliverables

Please provide:

- A working application
- Source code in a GitHub repository
- A README explaining:
  - Architecture
  - Key design decisions
  - How the multi-agent system works
  - How files and data are processed
  - How generated artifacts are created
  - Important trade-offs
- A short demonstration using a realistic business scenario
- At least two generated business artifacts

### Evaluation

We will primarily evaluate:

- Problem-solving ability
- Multi-agent system design
- Agent orchestration
- Ability to work with different types of information
- Data analysis quality
- Reliability and grounding
- Quality of generated artifacts
- Engineering practices
- Error handling
- Architectural reasoning
- Ability to explain technical trade-offs

The objective is not to build a production-ready platform. A focused, well-engineered solution with thoughtful design decisions is preferable to a large system with unnecessary complexity.
