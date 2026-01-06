# FPL Gameweek Recommendations Tool

A data-driven Fantasy Premier League analysis tool that provides weekly recommendations for captain picks, transfers, and differential players based on official FPL API data.


## Features

- **Top Captain Picks**: Get the 5 best captain options for the upcoming gameweek
- **Position-Specific Recommendations**: View top performers by position (GK, DEF, MID, FWD)
- **Differential Picks**: Discover low-owned players (<5%) with high potential
- **Smart Algorithm**: Considers form, fixtures, value, minutes played, and ICT index
- **Automatic & Manual Data Loading**: Auto-fetch from FPL API or manual JSON input

## Live Demo

🔗 [View Live Demo](https://anguitamitchell.github.io/FPL-Fantasy-predictor/)


## How It Works

The tool analyzes player data using a scoring algorithm that weighs:
Average Points Per Game: 5x weight (most important!)
Total Season Points: 0.5x weight (rewards consistency)
Recent Form: 4x weight (hot players)
Good Fixtures: 2x weight
Bonus Point Magnets: 2x weight per bonus
Template players (>20% owned): Bonus points

## Usage

### Option 1: Use Locally
1. Download `index.html`
2. Open it in any modern web browser
3. Click "Auto Fetch" or use "Manual Input"

### Option 2: GitHub Pages
Visit the live demo link above (no installation needed!)

### Manual Data Input Instructions
If auto-fetch doesn't work:
1. Click the "Manual Input" button
2. Visit: https://fantasy.premierleague.com/api/bootstrap-static/
3. Copy all the JSON data (Ctrl+A, Ctrl+C)
4. Paste into the text box
5. Click "Analyze Data"

## Installation for Development

```bash
# Clone the repository
git clone https://github.com/yourusername/fpl-recommendations-tool.git

# Navigate to directory
cd fpl-recommendations-tool

# Open in browser
open index.html
```

## Deployment to GitHub Pages

1. Create a new repository on GitHub
2. Upload `index.html` to the repository
3. Go to **Settings** → **Pages**
4. Under "Source", select your main branch
5. Click Save
6. Your tool will be live at `https://yourusername.github.io/fpl-recommendations-tool/`

## Technologies Used

- **React 18**: UI framework
- **Tailwind CSS**: Styling
- **Official FPL API**: Data source
- Pure JavaScript (no build process required)

## Data Source

This tool uses the official Fantasy Premier League API:
- Main data: `https://fantasy.premierleague.com/api/bootstrap-static/`
- Fixtures: `https://fantasy.premierleague.com/api/fixtures/`

Data updates automatically after each gameweek.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Ideas for Improvement
- Add team builder functionality
- Include transfer suggestions based on your current squad
- Add price change predictions
- Historical performance charts
- Chip usage recommendations

## License

GNU GENERAL PUBLIC LICENSE

## Disclaimer

This tool is not affiliated with or endorsed by the Premier League or Fantasy Premier League. It's a fan-made project for educational and entertainment purposes.

## Support

If you find this tool helpful, please ⭐ star the repository!

For issues or feature requests, please open an issue on GitHub.

---

**Happy FPL managing! 🏆⚽**
