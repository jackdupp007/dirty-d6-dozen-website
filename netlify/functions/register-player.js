// netlify/functions/register-player.js

// Ensure necessary libraries are imported
const { Octokit } = require('@octokit/rest');
const fetch = require('node-fetch');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Helper function to get file content from GitHub (defined within handler for cleaner scope)
  const getFileContent = async (octokitInstance, owner, repo, path, branch = 'main') => {
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
      console.error(`Error getting file ${path}:`, error.message);
      // Return a structured error for easier debugging
      return {
        error: true,
        statusCode: 500, 
        message: `Failed to retrieve ${path} from GitHub.`, 
        githubError: error.message, 
        stack: error.stack 
      };
    }
  };

  // Helper function to update file content on GitHub (defined within handler for cleaner scope)
  const updateFileContent = async (octokitInstance, owner, repo, path, content, message, branch = 'main', sha) => {
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
      console.error(`Error updating file ${path}:`, error.message);
      // Return a structured error for easier debugging
      return {
        error: true,
        statusCode: 500, 
        message: `Failed to update ${path} on GitHub.`, 
        githubError: error.message, 
        stack: error.stack 
      };
    }
  };

  const formData = new URLSearchParams(event.body);
  const player_name = formData.get('player_name');
  const player_faction = formData.get('player_faction');
  const warband_name = formData.get('warband_name');

  if (!player_name || !player_faction || !warband_name) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Player name, faction, and warband name are required.' }) };
  }

  // --- Configuration ---
  const githubRepoOwner = 'jackdupp007'; 
  const githubRepoName = 'dirty-d6-dozen-website';
  const githubBranch = 'main';
  const playersJsonPath = 'players.json';
  const leaderboardJsonPath = 'leaderboard.json';
  // You need to replace 'YOUR_NETLIFY_REGISTRATION_BUILD_HOOK_URL' with the URL you created for registration
  const registrationBuildHookUrl = 'https://api.netlify.com/build_hooks/68fdf0d75ce779c1e3949eb3'; // <<< YOUR REGISTRATION BUILD HOOK URL

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  try {
    // 1. Fetch current players.json content and SHA
    const playersFile = await getFileContent(octokit, githubRepoOwner, githubRepoName, playersJsonPath, githubBranch);
    if (playersFile.error) return { statusCode: playersFile.statusCode, body: JSON.stringify({ message: playersFile.message, githubError: playersFile.githubError }) };
    let players = JSON.parse(playersFile.content);
    const playersSha = playersFile.sha;

    // Check if player name or warband name already exists (case-insensitive)
    if (players.some(p => p.name.toLowerCase() === player_name.toLowerCase() || p.warband_name.toLowerCase() === warband_name.toLowerCase())) {
        return {
            statusCode: 409, // Conflict
            body: JSON.stringify({ message: `Player name "${player_name}" or Warband name "${warband_name}" is already registered. Please choose unique names.` }),
        };
    }

    // Generate a simple unique ID for the new player
    const newPlayerId = player_name.toLowerCase().replace(/[^a-z0-9]/g, '') + Date.now().toString().slice(-5);

    // Add new player to players.json
    const newPlayerEntry = {
      id: newPlayerId,
      name: player_name,
      faction: player_faction,
      warband_name: warband_name
    };
    players.push(newPlayerEntry);

    // 2. Update players.json on GitHub
    const playersUpdateResult = await updateFileContent(
      octokit, githubRepoOwner, githubRepoName, playersJsonPath,
      JSON.stringify(players, null, 2), // Pretty print JSON
      `Automated: Add new player registration: ${player_name}`, githubBranch, playersSha
    );
    if (playersUpdateResult.error) return { statusCode: playersUpdateResult.statusCode, body: JSON.stringify({ message: playersUpdateResult.message, githubError: playersUpdateResult.githubError }) };


    // 3. Fetch current leaderboard.json content and SHA
    const leaderboardFile = await getFileContent(octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath, githubBranch);
    if (leaderboardFile.error) return { statusCode: leaderboardFile.statusCode, body: JSON.stringify({ message: leaderboardFile.message, githubError: leaderboardFile.githubError }) };
    let leaderboard = JSON.parse(leaderboardFile.content);
    const leaderboardSha = leaderboardFile.sha;

    // Initialize new player in leaderboard with 0 points
    leaderboard.push({
        player_id: newPlayerId,
        player_name: player_name,
        faction: player_faction,
        warband_name: warband_name,
        campaign_points: 0,
        territories_held: 0
    });

    // 4. Update leaderboard.json on GitHub
    const leaderboardUpdateResult = await updateFileContent(
        octokit, githubRepoOwner, githubRepoName, leaderboardJsonPath,
        JSON.stringify(leaderboard, null, 2), // Pretty print JSON
        `Automated: Initialize new player ${player_name} in leaderboard`, githubBranch, leaderboardSha
    );
    if (leaderboardUpdateResult.error) return { statusCode: leaderboardUpdateResult.statusCode, body: JSON.stringify({ message: leaderboardUpdateResult.message, githubError: leaderboardUpdateResult.githubError }) };


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
    console.error('Netlify function global catch error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'An unexpected error occurred during registration.', error: error.message, stack: error.stack }),
    };
  }
};