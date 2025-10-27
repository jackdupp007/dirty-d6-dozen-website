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
    console.error(`Error getting file ${path} from GitHub:`, error.message);
    throw new Error(`Failed to retrieve ${path} from GitHub. (Error: ${error.message})`); // Throw for main handler to catch
  }
}

// Helper function to update file content on GitHub (TOP-LEVEL DEFINITION)
async function updateFileContent(octokitInstance, owner, repo, path, content, message, branch = 'main', sha) {
  try {
    await octokitInstance.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch,
    });
    return { success: true };
  } catch (error) {
    console.error(`Error updating file ${path} on GitHub:`, error.message);
    throw new Error(`Failed to update ${path} on GitHub. (Error: ${error.message})`); // Throw for main handler to catch
  }
}


exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const formData = new URLSearchParams(event.body);
  const game_notes = formData.get('game_notes');

  // Extract all data passed from the form (simplified structure, no territories)
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

  // --- Configuration ---
  const githubRepoOwner = 'jackdupp007'; // YOUR GITHUB USERNAME
  const githubRepoName = 'dirty-d6-dozen-website'; // YOUR REPOSITORY NAME
  const githubBranch = 'main'; // This is usually 'main'
  const leaderboardJsonPath = 'leaderboard.json';
  const buildHookUrl = 'https://api.netlify.com/build_hooks/68fddeac22142bfd35779040'; // YOUR GAME SUBMISSION BUILD HOOK URL

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  try {
    // 1. Fetch current leaderboard.json content and SHA from GitHub
    const leaderboardFile = await getFileContent(
      octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath, githubBranch
    );
    let leaderboard = JSON.parse(leaderboardFile.content);
    const leaderboardSha = leaderboardFile.sha;

    // 2. Update leaderboard data for Player 1
    const player1Index = leaderboard.findIndex(p => p.player_id === submission.player1_id);
    if (player1Index !== -1) {
        leaderboard[player1Index].campaign_points += submission.player1_score;
        // Territories removed: leaderboard[player1Index].territories_held += submission.winner_territories_gained;
    } else {
        console.warn(`Player 1 (${submission.player1_name}) not found in leaderboard. This should not happen if all registered players are in leaderboard.json.`);
        leaderboard.push({
            player_id: submission.player1_id,
            player_name: submission.player1_name,
            faction: 'Unknown',
            warband_name: 'Unknown',
            campaign_points: submission.player1_score,
            territories_held: 0 // Initialize, but won't be updated
        });
    }

    // 3. Update leaderboard data for Player 2
    const player2Index = leaderboard.findIndex(p => p.player_id === submission.player2_id);
    if (player2Index !== -1) {
        leaderboard[player2Index].campaign_points += submission.player2_score;
    } else {
        console.warn(`Player 2 (${submission.player2_name}) not found in leaderboard. This should not happen if all registered players are in leaderboard.json.`);
        leaderboard.push({
            player_id: submission.player2_id,
            player_name: submission.player2_name,
            faction: 'Unknown',
            warband_name: 'Unknown',
            campaign_points: submission.player2_score,
            territories_held: 0 // Initialize, but won't be updated
        });
    }
    
    // Sort leaderboard by campaign_points descending after updating
    leaderboard.sort((a, b) => b.campaign_points - a.campaign_points);

    // 4. Push updated leaderboard.json back to GitHub
    await updateFileContent(
      octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath,
      JSON.stringify(leaderboard, null, 2), // Pretty print JSON
      `Automated: Game report for ${submission.battleplan_name} between ${submission.player1_name} (${submission.player1_score}pts) and ${submission.player2_name} (${submission.player2_score}pts)`,
      githubBranch, leaderboardSha
    );

    // 5. Trigger Netlify build hook to update the live site
    const buildHookResponse = await fetch(buildHookUrl, { method: 'POST' });
    if (!buildHookResponse.ok) {
        console.error('Failed to trigger Netlify build hook:', buildHookResponse.statusText);
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to trigger Netlify site rebuild after updating files.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Game results submitted and site rebuild triggered!' }),
    };

  } catch (error) {
    console.error('Netlify function global catch error (update-leaderboard):', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'An unexpected error occurred during game submission.', error: error.message, stack: error.stack }),
    };
  }
};