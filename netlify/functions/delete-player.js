// netlify/functions/delete-player.js
const { Octokit } = require('@octokit/rest');
const fetch = require('node-fetch');

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
  const adminActionBuildHookUrl = 'https://api.netlify.com/build_hooks/68ff172f6eae16f13be0652e'; // !!! NEW BUILD HOOK HERE !!!

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
    if (playersFile.error) return { statusCode: playersFile.statusCode, body: JSON.stringify({ message: playersFile.message, githubError: playersFile.githubError }) };
    let players = JSON.parse(playersFile.content);
    const playersSha = playersFile.sha;

    // Find player name for commit message
    const playerToDeleteName = (players.find(p => p.id === playerIdToDelete) || {}).name || `ID:${playerIdToDelete}`;

    // Remove player from players.json
    const updatedPlayers = players.filter(p => p.id !== playerIdToDelete);
    if (updatedPlayers.length === players.length) {
        return { statusCode: 404, body: JSON.stringify({ message: `Player with ID ${playerIdToDelete} not found in players.json.` }) };
    }

    // 2. Update players.json on GitHub
    const playersUpdateResult = await updateFileContent(
      octokit, githubRepoOwner, githubRepoName, playersJsonPath,
      JSON.stringify(updatedPlayers, null, 2),
      `Automated: Remove player ${playerToDeleteName} from players.json`, githubBranch, playersSha
    );
    if (playersUpdateResult.error) return { statusCode: playersUpdateResult.statusCode, body: JSON.stringify({ message: playersUpdateResult.message, githubError: playersUpdateResult.githubError }) };


    // 3. Fetch current leaderboard.json
    const leaderboardFile = await getFileContent(octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath, githubBranch);
    if (leaderboardFile.error) return { statusCode: leaderboardFile.statusCode, body: JSON.stringify({ message: leaderboardFile.message, githubError: leaderboardFile.githubError }) };
    let leaderboard = JSON.parse(leaderboardFile.content);
    const leaderboardSha = leaderboardFile.sha;

    // Remove player from leaderboard.json
    const updatedLeaderboard = leaderboard.filter(p => p.player_id !== playerIdToDelete);

    // 4. Update leaderboard.json on GitHub
    const leaderboardUpdateResult = await updateFileContent(
        octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath,
        JSON.stringify(updatedLeaderboard, null, 2),
        `Automated: Remove player ${playerToDeleteName} from leaderboard.json`, githubBranch, leaderboardSha
    );
    if (leaderboardUpdateResult.error) return { statusCode: leaderboardUpdateResult.statusCode, body: JSON.stringify({ message: leaderboardUpdateResult.message, githubError: leaderboardUpdateResult.githubError }) };

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
    console.error('Netlify function global catch error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'An unexpected error occurred during player deletion.', error: error.message, stack: error.stack }),
    };
  }
};

// Helper functions (getFileContent, updateFileContent) - copy from register-player.js or update-leaderboard.js
// Ensure these helper functions are also present or imported correctly for this function
// If you are putting them at the top level of the file as before, use 'const'
// For this structure, they are defined inside the exports.handler scope.

// NOTE: For brevity, the helper functions are duplicated above.
// In a real project, you might put these into a shared utils file:
// `netlify/functions/utils/github.js` and `require('./utils/github.js')`
// But for simplicity of single-file functions, this inline approach works.
// Just make sure they are exactly as above within this file.