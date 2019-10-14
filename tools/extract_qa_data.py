#!/usr/bin/env python3
import argparse
import datetime
import json
import os
from pymongo import MongoClient


DEFAULT_CONFIG_PATH = 'config/configs.json'
DATABASE_NAME = 'digiklausur'


def main(action, collection_name, database_name, config_file, output_file):
    """
    query MongoDB database and extract questions and answers

    if 'action' == 'show', will show all available collections in database
    if 'action' == 'extract', will dump QA data of the specified collection into a JSON file. Format of JSON file:
        {
            "<question_id>": {
                "text": "<question_text>",
                "answers": {
                    "<answer_id>": {
                        "text": "<answer_text>",
                        "authors": { <username>: true },
                        "ranked_by": { <username>: <ranking_score> }
                    }
                    ...
                }
            }
            ...
        }
    """
    if not os.path.isfile(config_file):
        raise RuntimeError('config path is not a valid file: ' + config_file)
    with open(config_file) as in_file:
        configs = json.load(in_file)

    if not configs['mongo'] or not configs['mongo']['uri'] or not configs['mongo']['port']:
        raise RuntimeError('configurations in {} is invalid:\n{}'.format(config_file, configs))

    client = MongoClient('{}:{}/'.format(configs['mongo']['uri'], configs['mongo']['port']))
    database = client[database_name]
    if action == 'show':
        print('\n'.join(database.list_collection_names()))
        return

    if action == 'extract':
        if not collection_name:
            raise RuntimeError('no collection specified for extraction')
        print("reading collection '{}' from database '{}'".format(collection_name, database_name))
        collection = database.get_collection(collection_name)
        questions_doc = collection.find_one({'_id': 'questions'})
        if not questions_doc:
            raise RuntimeError("collection '{}' has no document 'questions'".format(collection_name))
        if not questions_doc['entries']:
            raise RuntimeError("no entry found in document 'questions'")

        # get answers
        question_data = {}
        for question_id, question_text in questions_doc['entries'].items():
            question_data[question_id] = {}
            question_data[question_id]['text'] = question_text

            ans_doc = collection.find_one({'_id': 'answers_{}'.format(question_id)})
            if not ans_doc or 'entries' not in ans_doc:
                print('no answer for question: ' + question_id)
                question_data[question_id]['answers'] = {}
                continue
            question_data[question_id]['answers'] = ans_doc['entries']

        # write to JSON file
        if not output_file:
            today_str = datetime.date.today().strftime('%Y-%m-%d')
            output_file = '{}_{}_{}.json'.format(today_str, DATABASE_NAME, collection_name)

        with open(output_file, 'w') as outfile:
            json.dump(question_data, outfile, indent=2)

        return

    raise RuntimeError('unsupported script action: ' + action)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Helper script to extract questions and answers from a MongoDB database')
    parser.add_argument('action', choices=['show', 'extract'],
                        help='show collections or extract question & answers from the specified collection')
    parser.add_argument('--collection', '-c', default=None,
                        help='name of collection to extract answers from')
    parser.add_argument('--config-file', '-f', default=DEFAULT_CONFIG_PATH,
                        help='configuration file for the MongoDB server (default: {})'.format(DEFAULT_CONFIG_PATH))
    parser.add_argument('--database', '-d', default=DATABASE_NAME,
                        help='Name of database containing QA data (default: {})'.format(DATABASE_NAME))
    parser.add_argument('--output-file', '-o', default=None, help='JSON file path to dump QA data')
    args = parser.parse_args()
    try:
        main(args.action, args.collection, args.database, args.config_file, args.output_file)
    except Exception as e:
        print(e)
        raise
