// netlify/functions/delete-player.js

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
  const playerIdToDelete = formData.get('player_id');
  const adminKey = formData.get('admin_key');

  // --- Configuration ---
  const githubRepoOwner = 'jackdupp007'; // <<< YOUR GITHUB USERNAME
  const githubRepoName = 'dirty-d6-dozen-website'; // <<< YOUR REPOSITORY NAME
  const githubBranch = 'main';
  const playersJsonPath = 'players.json';
  const leaderboardJsonPath = 'leaderboard.json';
  // You need to replace 'YOUR_NETLIFY_ADMIN_ACTION_BUILD_HOOK_URL' with the URL you created for admin actions
  const adminActionBuildHookUrl = 'https://api.netlify.com/build_hooks/68ff172f6eae16f13be0652e'; 

  // Check Admin Key
  if (adminKey !== process.env.ADMIN_KEY) {
      console.warn('Unauthorized attempt to delete player with incorrect Admin Key.');
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized: Incorrect Admin Key.' }) };
  }
  if (!playerIdToDelete) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Player ID to delete is required.' }) };
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  try {
    // 1. Fetch current players.json
    const playersFile = await getFileContent(octokit, githubRepoOwner, githubRepoName, playersJsonPath, githubBranch);
    let players = JSON.parse(playersFile.content);
    const playersSha = playersFile.sha;

    // Find player name for commit message
    const playerToDeleteName = (players.find(p => p.id === playerIdToDelete) || {}).name || `ID:${playerIdToDelete}`;

    // Remove player from players.json
    const updatedPlayers = players.filter(p => p.id !== playerIdToDelete);
    if (updatedPlayers.length === players.length) { // If length is same, player wasn't found
        return { statusCode: 404, body: JSON.stringify({ message: `Player with ID ${playerIdToDelete} not found in players.json.` }) };
    }

    // 2. Update players.json on GitHub
    await updateFileContent(
      octokit, githubRepoOwner, githubRepoName, playersJsonPath,
      JSON.stringify(updatedPlayers, null, 2),
      `Automated: Remove player ${playerToDeleteName} from players.json`, githubBranch, playersSha
    );


    // 3. Fetch current leaderboard.json
    const leaderboardFile = await getFileContent(octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath, githubBranch);
    let leaderboard = JSON.parse(leaderboardFile.content);
    const leaderboardSha = leaderboardFile.sha;

    // Remove player from leaderboard.json
    const updatedLeaderboard = leaderboard.filter(p => p.player_id !== playerIdToDelete);

    // 4. Update leaderboard.json on GitHub
    await updateFileContent(
        octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath,
        JSON.stringify(updatedLeaderboard, null, 2),
        `Automated: Remove player ${playerToDeleteName} from leaderboard.json`, githubBranch, leaderboardSha
    );

    // 5. Trigger Netlify build hook
    const buildHookResponse = await fetch(adminActionBuildHookUrl, { method: 'POST' });
    if (!buildHookResponse.ok) {
        console.error('Failed to trigger Netlify build hook:', buildHookResponse.statusText);
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to trigger Netlify site rebuild after deletion.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Player ${playerToDeleteName} removed and site rebuild triggered!` }),
    };

  } catch (error) {
    console.error('Netlify function global catch error (delete-player):', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'An unexpected error occurred during player deletion.', error: error.message, stack: error.stack }),
    };
  }
};