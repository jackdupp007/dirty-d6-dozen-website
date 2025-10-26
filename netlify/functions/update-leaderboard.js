// netlify/functions/update-leaderboard.js
const { Octokit } = require('@octokit/rest');
const fetch = require('node-fetch'); // Netlify Functions use node-fetch

// Helper function to get file content from GitHub
async function getFileContent(octokit, owner, repo, path, branch = 'main') {
  try {
    const { data } = await octokit.repos.getContent({
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
    console.error(`Error getting file ${path}:`, error.message);
    throw new Error(`Failed to retrieve ${path} from GitHub. Check file path or repo permissions. (Error: ${error.message})`);
  }
}

// Helper function to update file content on GitHub
async function updateFileContent(octokit, owner, repo, path, content, message, branch = 'main', sha) {
  try {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch,
    });
  } catch (error) {
    console.error(`Error updating file ${path}:`, error.message);
    throw new Error(`Failed to update ${path} on GitHub. Check branch, SHA, or repo permissions. (Error: ${error.message})`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse form data from event body
  const formData = new URLSearchParams(event.body);
  const game_notes = formData.get('game_notes');

  // Extract all data passed from the form (simplified structure)
  const submission = {
    player1_id: formData.get('player1_id'),
    player1_name: formData.get('player1_name'),
    player1_score: parseInt(formData.get('player1_score')),
    
    player2_id: formData.get('player2_id'),
    player2_name: formData.get('player2_name'),
    player2_score: parseInt(formData.get('player2_score')),

    battleplan_name: formData.get('battleplan_name'),
    total_rounds: parseInt(formData.get('total_rounds')),
    game_notes: game_notes,
    timestamp: new Date().toISOString()
  };

  // --- Configuration (YOUR UPDATED VALUES) ---
  const githubRepoOwner = 'jackdupp007'; // <<< YOUR GITHUB USERNAME
  const githubRepoName = 'dirty-d6-dozen-website'; // <<< YOUR REPOSITORY NAME
  const githubBranch = 'main'; // This is usually 'main'
  const leaderboardJsonPath = 'leaderboard.json';
  const buildHookUrl = 'https://api.netlify.com/build_hooks/68fddeac22142bfd35779040'; // <<< YOUR NETLIFY BUILD HOOK URL

  // Initialize Octokit with the GITHUB_TOKEN from Netlify environment variables
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  try {
    // 1. Fetch current leaderboard.json content and SHA from GitHub
    const { content: currentLeaderboardContent, sha: leaderboardSha } = await getFileContent(
      octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath, githubBranch
    );
    let leaderboard = JSON.parse(currentLeaderboardContent);

    // 2. Update leaderboard data for Player 1
    const player1Index = leaderboard.findIndex(p => p.player_id === submission.player1_id);
    if (player1Index !== -1) {
        leaderboard[player1Index].campaign_points += submission.player1_score;
        // Territories can be added here based on a rule (e.g., if score > 0, gain 1 territory)
        // For now, let's keep it simple: points are just added.
    } else {
        console.warn(`Player 1 (${submission.player1_name}) not found in leaderboard. This should not happen if all registered players are in leaderboard.json.`);
        // Consider if you want to auto-add new players if not present, but it's best to pre-populate.
    }

    // 3. Update leaderboard data for Player 2
    const player2Index = leaderboard.findIndex(p => p.player_id === submission.player2_id);
    if (player2Index !== -1) {
        leaderboard[player2Index].campaign_points += submission.player2_score;
    } else {
        console.warn(`Player 2 (${submission.player2_name}) not found in leaderboard. This should not happen if all registered players are in leaderboard.json.`);
    }
    
    // Sort leaderboard by campaign_points descending after updating
    leaderboard.sort((a, b) => b.campaign_points - a.campaign_points);

    // 4. Push updated leaderboard.json back to GitHub
    await updateFileContent(
      octokit,
      githubRepoOwner,
      githubRepoName,
      leaderboardJsonPath,
      JSON.stringify(leaderboard, null, 2), // Pretty print JSON
      `Automated: Game report for ${submission.battleplan_name} between ${submission.player1_name} (${submission.player1_score}pts) and ${submission.player2_name} (${submission.player2_score}pts)`,
      githubBranch,
      leaderboardSha
    );

    // 5. Trigger Netlify build hook to update the live site
    await fetch(buildHookUrl, { method: 'POST' });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Game results submitted and site rebuild triggered!' }),
    };

  } catch (error) {
    console.error('Netlify function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error processing game submission.', error: error.message }),
    };
  }
};