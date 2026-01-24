i have added the source code of another project i worked on called watchy to the research folder.

i would like to add some of it's functionality to this discord bot and am providing it for reference.

the main features to add:

1. search api bay with a new !search command. search results present up to 10 results. every new search result entry has a unique running "m number", a number prefixed with an m for magnet. the first 10 results ever would be m1, m2, m3, m4, etc. if we have seen a magnet before reuse it's existing m number. we will need to maintain a database as a simple json for now  that we write out to disk/load from disk. we will need the name, seeders, leechers, magnet link and it's "m number" for each result.  

2. !open command takes either an "m number" or a raw magnet link uses our alldebrid api key, attempts to unlock it, and reports back the status. if it is able to be unlocked reply with all videos numbered

3. !play command takes the same parameter types as the !open command as well as an additional parameter that is a number. the play command will play the video file in VLC from the numbered videos within the magnet link that was viewed with an !open command. if a number is omitted the first listed file is played.
