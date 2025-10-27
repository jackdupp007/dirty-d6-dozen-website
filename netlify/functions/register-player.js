// netlify/functions/register-player.js

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
    throw new Error(`Failed to retrieve ${path} from GitHub. (Error: ${error.message})`);
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
    throw new Error(`Failed to update ${path} on GitHub. (Error: ${error.message})`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const formData = new URLSearchParams(event.body);
  const player_name = formData.get('player_name');
  const player_faction = formData.get('player_faction');
  const warband_name = formData.get('warband_name');

  if (!player_name || !player_faction || !warband_name) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Player name, faction, and warband name are required.' }) };
  }

  // --- Configuration ---
  const githubRepoOwner = 'jackdupp007'; // YOUR GITHUB USERNAME
  const githubRepoName = 'dirty-d6-dozen-website'; // YOUR REPOSITORY NAME
  const githubBranch = 'main';
  const playersJsonPath = 'players.json';
  const leaderboardJsonPath = 'leaderboard.json';
  const registrationBuildHookUrl = 'https://api.netlify.com/build_hooks/68fdf0d75ce779c1e3949eb3'; // YOUR REGISTRATION BUILD HOOK URL

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  try {
    // 1. Fetch current players.json content and SHA
    const playersFile = await getFileContent(octokit, githubRepoOwner, githubRepoName, playersJsonPath, githubBranch);
    let players = JSON.parse(playersFile.content);
    const playersSha = playersFile.sha;

    // Generate a simple unique ID for the new player
    const newPlayerId = player_name.toLowerCase().replace(/[^a-z0-9]/g, '') + Date.now().toString().slice(-5);

    // Check if player name or warband name already exists (case-insensitive)
    if (players.some(p => p.name.toLowerCase() === player_name.toLowerCase() || p.warband_name.toLowerCase() === warband_name.toLowerCase())) {
        return {
            statusCode: 409, // Conflict
            body: JSON.stringify({ message: `Player name "${player_name}" or Warband name "${warband_name}" is already registered. Please choose unique names.` }),
        };
    }

    // Add new player to players.json
    const newPlayerEntry = {
      id: newPlayerId,
      name: player_name,
      faction: player_faction,
      warband_name: warband_name
    };
    players.push(newPlayerEntry);

    // 2. Update players.json on GitHub
    await updateFileContent(
      octokit, githubRepoOwner, githubRepoName, playersJsonPath,
      JSON.stringify(players, null, 2),
      `Automated: Add new player registration: ${player_name}`, githubBranch, playersSha
    );

    // 3. Fetch current leaderboard.json content and SHA
    const leaderboardFile = await getFileContent(octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath, githubBranch);
    let leaderboard = JSON.parse(leaderboardFile.content);
    const leaderboardSha = leaderboardFile.sha;

    // Initialize new player in leaderboard with 0 points (no territories_held now)
    leaderboard.push({
        player_id: newPlayerId,
        player_name: player_name,
        faction: player_faction,
        warband_name: warband_name,
        campaign_points: 0
        // Removed: territories_held: 0
    });

    // 4. Update leaderboard.json on GitHub
    await updateFileContent(
        octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath,
        JSON.stringify(leaderboard, null, 2),
        `Automated: Initialize new player ${player_name} in leaderboard`, githubBranch, leaderboardSha
    );

    // 5. Trigger Netlify build hook to update the live site
    const buildHookResponse = await fetch(registrationBuildHookUrl, { method: 'POST' });
    if (!buildHookResponse.ok) {
        console.error('Failed to trigger Netlify build hook:', buildHookResponse.statusText);
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to trigger Netlify site rebuild after updating files.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Player registered, data updated, and site rebuild triggered!' }),
    };

  } catch (error) {
    console.error('Netlify function global catch error (register-player):', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'An unexpected error occurred during registration.', error: error.message, stack: error.stack }),
    };
  }
};