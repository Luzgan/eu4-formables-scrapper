# Description

Scrapper that lets you get some information about formable countries. Right now it is focusing on finding formables, with pernament bonuses, that are not end game tags - but you can play around with the way data is read, to make it fit to your needs.

Obviously, because we are parsing here - there is possibility for mistakes, so if you notice something, please let me know.

# Prerequisite

1. Install node 18.17+
2. Run `npm ci`
3. Run `npx playwright install`
4. Run `node index.js`

Now script will scrap (and cache) pages related to formables and on the end it will create a result csv file, with all countries that are formable, are not end tag and have pernament bonuses from missions.

# What is being parsed

1. Formable countries
2. Missions of countries that have unique tree
3. Missions events

# Plan for a future

1. Parse country events
2. Parse country decisions
3. Parse what pernament bonuses are provided (though this one might be tricky :) )
4. UI
