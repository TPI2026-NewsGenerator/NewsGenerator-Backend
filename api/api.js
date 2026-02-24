// Fetch
const API_URL = 'http://localhost:3001/api';

export const fetchNews = async (query) => {
    const response = await fetch(`${API_URL}/news`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({query}),
    });

    return await response.json();
};
