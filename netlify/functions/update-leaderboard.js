// netlify/functions/update-leaderboard.js

// Ensure necessary libraries are imported
const { Octokit } = require('@octokit/rest');
const fetch = require('node-fetch');

// Helper function to get file content from GitHub (TOP-LEVEL DEFINITION)
async function getFileContent(octokitInstance, owner, repo, path, branch = 'main') {
  try {
    const { data } = await octokitInstance.repos.getContent({
      owner,
      repo,
      path,
      branch,
    });
    return {
      content: Buffer.from(data.content, 'base64').toString('utf8'),
      sha: data.sha,
    };
  } catch (error) {
    // If file is not found, return null for content and sha so we can initialize it
    if (error.status === 404) {
      console.warn(`File ${path} not found. Will create it.`);
      return { content: null, sha: null };
    }
    console.error(`Error getting file ${path} from GitHub:`, error.message);
    throw new Error(`Failed to retrieve ${path} from GitHub. (Error: ${error.message})`);
  }
}

// NOTE: updateFileContent helper is no longer used for multiple files,
// we will use the Octokit API for creating trees/commits directly for atomicity.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const formData = new URLSearchParams(event.body);

  // Extract ALL new and existing data passed from the form
  const submission = {
    player1_id: formData.get('player1_id'),
    player1_name: formData.get('player1_name'),
    player1_score: parseInt(formData.get('player1_score')),
    player1_faction: formData.get('player1_faction'),   // NEW FIELD
    player1_warband: formData.get('player1_warband'),   // NEW FIELD
    
    player2_id: formData.get('player2_id'),
    player2_name: formData.get('player2_name'),
    player2_score: parseInt(formData.get('player2_score')),
    player2_faction: formData.get('player2_faction'),   // NEW FIELD
    player2_warband: formData.get('player2_warband'),   // NEW FIELD

    battleplan_name: formData.get('battleplan_name'),
    total_rounds: parseInt(formData.get('total_rounds')),
    game_date: formData.get('game_date'),               // NEW FIELD (YYYY-MM-DD)
    game_notes: formData.get('game_notes'),
    round_history: JSON.parse(formData.get('round_history')), // NEW FIELD (JSON string, parse it back)
    timestamp: new Date().toISOString() // Server-side timestamp for accuracy
  };

  // --- Configuration ---
  const githubRepoOwner = 'jackdupp007'; // YOUR GITHUB USERNAME
  const githubRepoName = 'dirty-d6-dozen-website'; // YOUR REPOSITORY NAME
  const githubBranch = 'main'; // This is usually 'main'
  const leaderboardJsonPath = 'data/leaderboard.json'; // Updated path
  const gameResultsJsonPath = 'data/game_results.json'; // NEW: Path for game history
  const buildHookUrl = 'https://api.netlify.com/build_hooks/68fddeac22142bfd35779040'; // YOUR GAME SUBMISSION BUILD HOOK URL

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  try {
    // --- PART 1: Update leaderboard.json ---

    // 1. Fetch current leaderboard.json content and SHA from GitHub
    const leaderboardFile = await getFileContent(
      octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath, githubBranch
    );
    let leaderboard = leaderboardFile.content ? JSON.parse(leaderboardFile.content) : [];
    
    // 2. Update leaderboard data for Player 1
    const player1Index = leaderboard.findIndex(p => p.player_id === submission.player1_id);
    if (player1Index !== -1) {
        leaderboard[player1Index].campaign_points += submission.player1_score;
        // Ensure faction/warband are up-to-date if they registered with defaults
        leaderboard[player1Index].faction = submission.player1_faction;
        leaderboard[player1Index].warband_name = submission.player1_warband;
    } else {
        console.warn(`Player 1 (${submission.player1_name}) not found in leaderboard. Adding new entry.`);
        leaderboard.push({
            player_id: submission.player1_id,
            player_name: submission.player1_name,
            faction: submission.player1_faction, // Use submitted faction
            warband_name: submission.player1_warband, // Use submitted warband
            campaign_points: submission.player1_score,
            territories_held: 0 // Initialize, but won't be updated
        });
    }

    // 3. Update leaderboard data for Player 2
    const player2Index = leaderboard.findIndex(p => p.player_id === submission.player2_id);
    if (player2Index !== -1) {
        leaderboard[player2Index].campaign_points += submission.player2_score;
        // Ensure faction/warband are up-to-date if they registered with defaults
        leaderboard[player2Index].faction = submission.player2_faction;
        leaderboard[player2Index].warband_name = submission.player2_warband;
    } else {
        console.warn(`Player 2 (${submission.player2_name}) not found in leaderboard. Adding new entry.`);
        leaderboard.push({
            player_id: submission.player2_id,
            player_name: submission.player2_name,
            faction: submission.player2_faction, // Use submitted faction
            warband_name: submission.player2_warband, // Use submitted warband
            campaign_points: submission.player2_score,
            territories_held: 0 // Initialize, but won't be updated
        });
    }
    
    // Sort leaderboard by campaign_points descending after updating
    leaderboard.sort((a, b) => b.campaign_points - a.campaign_points);


    // --- PART 2: Update game_results.json ---

    // 1. Fetch current game_results.json content and SHA from GitHub
    const gameResultsFile = await getFileContent(
      octokit, githubRepoOwner, githubRepoName, gameResultsJsonPath, githubBranch
    );
    let gameResults = gameResultsFile.content ? JSON.parse(gameResultsFile.content) : [];
    
    // 2. Construct the new game entry
    const newGameEntry = {
        id: Date.now().toString(), // Unique ID for this game
        date: submission.game_date,
        battleplan: submission.battleplan_name,
        total_rounds: submission.total_rounds,
        player1: {
            id: submission.player1_id,
            name: submission.player1_name,
            faction: submission.player1_faction,
            warband: submission.player1_warband,
            score: submission.player1_score
        },
        player2: {
            id: submission.player2_id,
            name: submission.player2_name,
            faction: submission.player2_faction,
            warband: submission.player2_warband,
            score: submission.player2_score
        },
        notes: submission.game_notes,
        round_history: submission.round_history, // The full round history from frontend
        submitted_at: submission.timestamp // Timestamp when the function processed it
    };
    gameResults.push(newGameEntry); // Add the new game to the history


    // --- PART 3: Commit BOTH updated JSON files to GitHub in a single commit ---

    // Get the latest commit SHA of the branch
    const { data: refData } = await octokit.git.getRef({
      owner: githubRepoOwner,
      repo: githubRepoName,
      ref: `heads/${githubBranch}`,
    });
    const latestCommitSha = refData.object.sha;

    // Get the tree SHA of that commit
    const { data: commitData } = await octokit.git.getCommit({
      owner: githubRepoOwner,
      repo: githubRepoName,
      commit_sha: latestCommitSha,
    });
    const latestTreeSha = commitData.tree.sha;

    // Create blobs for the updated file contents
    const { data: leaderboardBlob } = await octokit.git.createBlob({
      owner: githubRepoOwner,
      repo: githubRepoName,
      content: JSON.stringify(leaderboard, null, 2),
      encoding: 'utf-8',
    });

    const { data: gameResultsBlob } = await octokit.git.createBlob({
      owner: githubRepoOwner,
      repo: githubRepoName,
      content: JSON.stringify(gameResults, null, 2),
      encoding: 'utf-8',
    });

    // Create a new tree with the updated file entries
    const { data: newTreeData } = await octokit.git.createTree({
      owner: githubRepoOwner,
      repo: githubRepoName,
      base_tree: latestTreeSha, // Base it on the existing tree
      tree: [
        {
          path: leaderboardJsonPath, // Path in repo
          mode: '100644', // File mode (blob)
          type: 'blob',
          sha: leaderboardBlob.sha, // SHA of the new content blob
        },
        {
          path: gameResultsJsonPath, // Path in repo
          mode: '100644',
          type: 'blob',
          sha: gameResultsBlob.sha,
        },
      ],
    });

    // Create a new commit referencing the old commit and the new tree
    const commitMessage = `Automated: Game report for ${submission.battleplan_name} between ${submission.player1_name} (${submission.player1_score}pts) and ${submission.player2_name} (${submission.player2_score}pts)`;
    const { data: newCommitData } = await octokit.git.createCommit({
      owner: githubRepoOwner,
      repo: githubRepoName,
      message: commitMessage,
      tree: newTreeData.sha,
      parents: [latestCommitSha], // Link to the previous commit
    });

    // Update the branch reference to point to the new commit
    await octokit.git.updateRef({
      owner: githubRepoOwner,
      repo: githubRepoName,
      ref: `heads/${githubBranch}`,
      sha: newCommitData.sha,
    });

    // --- PART 4: Trigger Netlify build hook (optional, as GitHub push usually triggers a build) ---
    // Keeping this in as a failsafe, as it was in your original code.
    const buildHookResponse = await fetch(buildHookUrl, { method: 'POST' });
    if (!buildHookResponse.ok) {
        console.error('Failed to trigger Netlify build hook:', buildHookResponse.statusText);
        // Do not return error here, as files were successfully updated on GitHub.
        // The build might just be slightly delayed, but the data is safe.
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Game results submitted, leaderboard and game history updated, and site rebuild triggered!' }),
      headers: { 'Content-Type': 'application/json' }
    };

  } catch (error) {
    console.error('Netlify function global catch error (update-leaderboard):', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'An unexpected error occurred during game submission.', error: error.message, stack: error.stack }),
      headers: { 'Content-Type': 'application/json' }
    };
  }
};