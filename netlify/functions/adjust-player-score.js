// netlify/functions/adjust-player-score.js

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
  const playerIdToAdjust = formData.get('player_id');
  const pointsChange = parseInt(formData.get('points_change'));
  const territoriesChange = parseInt(formData.get('territories_change'));
  const adminKey = formData.get('admin_key');

  // --- Configuration ---
  const githubRepoOwner = 'jackdupp007'; // <<< YOUR GITHUB USERNAME
  const githubRepoName = 'dirty-d6-dozen-website'; // <<< YOUR REPOSITORY NAME
  const githubBranch = 'main';
  const leaderboardJsonPath = 'leaderboard.json';
  // You need to replace 'YOUR_NETLIFY_ADMIN_ACTION_BUILD_HOOK_URL' with the URL you created for admin actions
  const adminActionBuildHookUrl = 'https://api.netlify.com/build_hooks/68ff172f6eae16f13be0652e'; 

  // Check Admin Key
  if (adminKey !== process.env.ADMIN_KEY) {
      console.warn('Unauthorized attempt to adjust score with incorrect Admin Key.');
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized: Incorrect Admin Key.' }) };
  }
  if (!playerIdToAdjust || isNaN(pointsChange) || isNaN(territoriesChange)) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Player ID, points change, and territories change are required and must be numbers.' }) };
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  try {
    // 1. Fetch current leaderboard.json
    const leaderboardFile = await getFileContent(octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath, githubBranch);
    let leaderboard = JSON.parse(leaderboardFile.content);
    const leaderboardSha = leaderboardFile.sha;

    // Find and adjust player's scores
    const playerIndex = leaderboard.findIndex(p => p.player_id === playerIdToAdjust);
    if (playerIndex !== -1) {
        leaderboard[playerIndex].campaign_points = Math.max(0, leaderboard[playerIndex].campaign_points + pointsChange);
        leaderboard[playerIndex].territories_held = Math.max(0, leaderboard[playerIndex].territories_held + territoriesChange);
    } else {
        return { statusCode: 404, body: JSON.stringify({ message: `Player with ID ${playerIdToAdjust} not found in leaderboard.` }) };
    }
    
    // Sort leaderboard by campaign_points descending after updating
    leaderboard.sort((a, b) => b.campaign_points - a.campaign_points);

    // 2. Push updated leaderboard.json back to GitHub
    await updateFileContent(
      octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath,
      JSON.stringify(leaderboard, null, 2),
      `Automated: Adjust score for ${leaderboard[playerIndex].player_name} (Points: ${pointsChange}, Territories: ${territoriesChange})`,
      githubBranch, leaderboardSha
    );

    // 3. Trigger Netlify build hook
    const buildHookResponse = await fetch(adminActionBuildHookUrl, { method: 'POST' });
    if (!buildHookResponse.ok) {
        console.error('Failed to trigger Netlify build hook:', buildHookResponse.statusText);
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to trigger Netlify site rebuild after score adjustment.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Score adjusted and site rebuild triggered!' }),
    };

  } catch (error) {
    console.error('Netlify function global catch error (adjust-player-score):', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'An unexpected error occurred during score adjustment.', error: error.message, stack: error.stack }),
    };
  }
};