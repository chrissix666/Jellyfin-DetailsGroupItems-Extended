# Jellyfin DetailsGroupItems Extension

For **Jellyfin Web**, 

works with **JavaScript Injector** 

and requires an **OMDb API key** (free key with 1,000 requests per day).

This script extends Jellyfin’s **DetailsGroupItems** section (Genres, Directors, Writers, Studios) with additional metadata fetched from **OMDb**. It adds **Country**, **Awards**, and **Box Office** information directly to the item details view.

Movies and TV shows are handled separately, allowing different behavior depending on the media type.  
For each type, individual metadata rows can be enabled or disabled, and the display order of those rows can be freely configured.

For movies, the script supports displaying country of origin, awards information, and box office data.  
For TV shows, country of origin and awards information can be shown on the main series page.  
Each row can be shown or hidden independently, and only enabled rows are rendered.

The order in which the rows appear is fully configurable for movies and TV shows individually. Rows that are disabled or removed from the configured order are completely removed from the UI. The injected rows fully match the appearance and behavior of Jellyfin’s native DetailsGroupItems. Font weight, underline handling, hover effects, and interaction behavior are adjusted so the additional metadata integrates seamlessly and is visually indistinguishable from the original entries. External links are resolved automatically by parsing the available provider IDs, ensuring that each row opens the correct destination (IMDb Awards, IMDB Locations, TMDb Awards, or IMDB Box Office Mojo) depending on media type and context.

<img src="Screenshot.png" width="600">

---

## Installation

- Intended for **Jellyfin Web**
- Requires a **JavaScript Injector** (e.g. Jellyfin JavaScript Injector plugin or userscript manager)
- Paste the script into the injector
- Don't forget to insert your **OMDb API key** into the script
- Save and reload the Jellyfin Web interface

---

## Tested on

- Windows 11  
- Chrome  
- Jellyfin Web 10.10.7 

---

## License

MIT
