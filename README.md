# Football-lab

Football-lab is a research prototype for football tactics simulation and analysis.

## Structure
- `frontend`: React + Vite client for drawing tactics and viewing analysis
- `backend`: FastAPI service for simulation and analysis APIs

## Environment
- Node.js 20+
- Python 3.11+

## Frontend
```bash
cd frontend
npm install
npm run dev
```

### Frontend Interaction
- Home (`/`), Simulation (`/simulation`), Analysis (`/analysis`) screens are separated by URL so the workflow is easier to follow
- Use the Home screen guide docs as the starting workflow for the prototype
- The Home screen is now simplified into a hero intro plus two workflow cards so the prototype purpose and next action are readable at a glance
- Drag any player to change tactical positioning
- Every drag is recorded as a player movement path on the timeline
- Click a movement path to select it, then edit or delete that path from the toolbar
- Rename the selected tactic sequence inline and keep that name in exported JSON
- Choose which player starts with the ball before the first pass of the scenario
- Working-board reset clears only the live board and keeps saved sequences and analysis history
- Full project reset is now separated into a dedicated delete-all action
- Only the current ball owner can start a pass
- Toggle shot mode and click the pitch to record a real shot event from the current ball owner
- Every shot is automatically classified as goal, saved shot, off target, or blocked based on lane pressure and goalkeeper distance
- Click the ball owner first and then another player to create a passing lane
- Passes are only allowed between teammates
- The ball image travels along the pass path so the current ball position is easy to track
- Replay saved movement and pass sequences together in chronological order with playback controls
- Automatically group recorded events into tactic sequences and replay a selected sequence only
- When no sequence is selected, previously recorded sequence paths stay hidden so a new sequence can start on a clean board
- Send the selected sequence to the FastAPI backend for server-side tactical analysis
- Keep per-sequence backend analysis history and compare the latest result against the previous run
- Turn on comparison mode and click chart points or history entries to choose a custom baseline analysis
- Visualize sequence analysis history with trend charts plus player involvement, progression-zone, and lateral-occupancy bars
- Visualize Voronoi influence zones, pass networks, xG proxy threat points, and EPV proxy heatmaps in the analysis screen
- xG and EPV visualizations now also reflect explicit shot events, not only pass or movement destinations
- Review shot-outcome distribution in the analysis screen to compare finishing quality and defensive shot suppression
- Pause playback and resume from the same timeline position
- Adjust playback speed with dedicated speed controls
- In Simulation, the pitch stays on the left and the control center, sequence list, and focus cards are grouped vertically on the right
- In Analysis, the pitch stays in the top workspace and the dashboard cards are collected in the lower section
- Each analysis card now supports an expand-view modal so one metric can be inspected in isolation
- Saved JSON keeps real event timing values plus tactic sequence grouping for passes and movements
- Saved JSON also preserves sequence analysis history
- Passing arrows are color-coded by success probability
- During playback, defenders react automatically to each pass or movement event even without manual defensive input
- During playback, the side panel automatically locks onto the currently replayed pass or movement
- Hover a pass or movement path to inspect analysis metrics in the side panel
- Click a pass arrow to remove that single passing lane
- Import a previously saved board from JSON
- Export the current board state as a JSON file
- Use the reset buttons to clear passes or restore the default board

## Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Backend API
- `GET /health`: simple backend health check
- `POST /analysis/sequence`: analyze one saved tactic sequence and return duration, progression, pressure, width, shot summary, coaching note, and defensive shift simulation metrics
- `POST /analysis/sequence` now also returns backend-generated xG threat points, EPV heatmap cells, and shot-outcome distribution so the analysis screen can prioritize server-side calculations
- Defensive shift output now reflects marking priority, conservative deep-line stepping, and horizontal line-spacing rules instead of a uniform full-line slide

## Next Goal
- Build the stage-1 11vs11 simulation loop
- Connect the frontend tactic board to the backend simulation API
